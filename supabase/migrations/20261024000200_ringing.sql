-- Phase 2A: "Call" from the dashboard with ringing (Rule 3). Service role only.
--
-- A guest with a valid sponsored connection rings the sponsor; the call starts only when the
-- sponsor accepts (30 s, then "missed"). After the window expires a guest with their own
-- minutes calls as the host and payer of a new meeting, ringing the former host. A guest with
-- an expired window and 0 minutes cannot call (the UI offers Subscribe / Message).

alter table public.call_sessions
  add column callee_id uuid references public.profiles (id) on delete set null;
create index call_sessions_ringing_idx on public.call_sessions (callee_id) where status = 'ringing';

insert into private.app_settings (key, value) values ('ring_timeout_seconds', '30')
on conflict (key) do nothing;

create function private.ring_timeout() returns interval
language sql stable security definer set search_path = '' as $$
  select make_interval(secs => coalesce(
    (select value::int from private.app_settings where key = 'ring_timeout_seconds'), 30))
$$;

-- Marks unanswered calls as missed (run before reading or answering ringing sessions).
create function public.expire_ringing()
returns int
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.call_sessions set status = 'missed', ended_at = now(), end_reason = 'no_answer'
    where status = 'ringing' and created_at < now() - private.ring_timeout()
    returning 1
  )
  select count(*)::int from expired
$$;

-- What "Call" does for p_caller in p_meeting:
--   mode 'direct'  the caller is the host → open the room
--   mode 'join'    a session is already open → join it
--   mode 'ringing' a ringing session was created (session_id, callee_id); meeting_id may be a
--                  new meeting when an expired guest calls with their own minutes
create function public.create_call(p_meeting uuid, p_caller uuid)
returns table (mode text, meeting_id uuid, session_id uuid, callee_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rights text := public.call_rights(p_meeting, p_caller);
  v_owner uuid;
  v_callee uuid;
  v_meeting uuid := p_meeting;
  v_open uuid;
  v_session uuid;
  v_created timestamptz;
begin
  perform public.expire_ringing();
  if v_rights is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select owner_id into v_owner from public.meetings where id = p_meeting;

  if v_rights = 'host' then
    return query select 'direct'::text, p_meeting, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  select cs.id into v_open from public.call_sessions cs
  where cs.meeting_id = p_meeting and cs.status in ('ready', 'live');
  if v_open is not null then
    return query select 'join'::text, p_meeting, v_open, null::uuid, null::timestamptz;
    return;
  end if;

  if v_rights = 'sponsored' then
    -- Ring the sponsor of the caller's valid connection.
    select sc.sponsor_id into v_callee from public.sponsored_connections sc
    where sc.meeting_id = p_meeting and sc.guest_id = p_caller
      and sc.revoked_at is null and sc.expires_at > now()
    order by sc.expires_at desc limit 1;
  else
    -- Expired window: the guest calls as host and payer of a new meeting (needs own minutes).
    if not public.has_available_minutes(p_caller) then
      raise exception 'NO_MINUTES';
    end if;
    v_callee := v_owner;
    insert into public.meetings (owner_id, room_name)
    values (p_caller, 'm-' || replace(gen_random_uuid()::text, '-', ''))
    returning id into v_meeting;
    insert into public.sponsored_connections (sponsor_id, guest_id, meeting_id, expires_at)
    values (p_caller, v_callee, v_meeting, now() + interval '24 hours');
  end if;

  -- One ringing call per caller and meeting at a time.
  select cs.id, cs.created_at into v_session, v_created from public.call_sessions cs
  where cs.meeting_id = v_meeting and cs.initiated_by = p_caller and cs.status = 'ringing';
  if v_session is null then
    insert into public.call_sessions (meeting_id, host_id, initiated_by, callee_id, status)
    select v_meeting, m.owner_id, p_caller, v_callee, 'ringing'
    from public.meetings m where m.id = v_meeting
    returning id, created_at into v_session, v_created;
  end if;

  return query select 'ringing'::text, v_meeting, v_session, v_callee, v_created + private.ring_timeout();
end
$$;

-- The callee answers. Accept → the session becomes the meeting's open "ready" session (or, if
-- one is already open, both join that one). Outcomes are returned, not raised, so an expiry
-- recorded here is kept: accepted | declined | expired | closed.
create function public.answer_call(p_session uuid, p_user uuid, p_accept boolean)
returns table (meeting_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.call_sessions;
begin
  perform public.expire_ringing();
  select * into v_session from public.call_sessions where id = p_session for update;
  if not found or v_session.callee_id is distinct from p_user then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_session.status = 'missed' then
    return query select v_session.meeting_id, 'expired'::text;
    return;
  end if;
  if v_session.status <> 'ringing' then
    return query select v_session.meeting_id, 'closed'::text;
    return;
  end if;

  if not p_accept then
    update public.call_sessions set status = 'declined', ended_at = now(), end_reason = 'declined'
    where id = p_session;
    return query select v_session.meeting_id, 'declined'::text;
    return;
  end if;

  begin
    update public.call_sessions set status = 'ready' where id = p_session;
  exception when unique_violation then
    -- A session is already open in this meeting: answer by joining it.
    update public.call_sessions set status = 'ended', ended_at = now(), end_reason = 'merged'
    where id = p_session;
  end;
  return query select v_session.meeting_id, 'accepted'::text;
end
$$;

-- The caller hangs up (or the ring timed out on their screen): ringing → missed.
create function public.cancel_call(p_session uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_callee uuid;
begin
  update public.call_sessions
  set status = 'missed', ended_at = now(), end_reason = 'caller_cancelled'
  where id = p_session and initiated_by = p_user and status = 'ringing'
  returning callee_id into v_callee;
  return v_callee;
end
$$;

-- Calls ringing for p_user right now (shown when the dashboard opens).
create function public.incoming_calls(p_user uuid)
returns table (session_id uuid, meeting_id uuid, caller_id uuid, caller_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.expire_ringing();
  return query
    select cs.id, cs.meeting_id, cs.initiated_by, coalesce(nullif(p.full_name, ''), 'Your partner'),
           cs.created_at + private.ring_timeout()
    from public.call_sessions cs
    join public.profiles p on p.id = cs.initiated_by
    where cs.callee_id = p_user and cs.status = 'ringing'
    order by cs.created_at desc;
end
$$;

revoke execute on function
  private.ring_timeout(),
  public.expire_ringing(),
  public.create_call(uuid, uuid),
  public.answer_call(uuid, uuid, boolean),
  public.cancel_call(uuid, uuid),
  public.incoming_calls(uuid)
from public, anon, authenticated;
grant execute on function
  public.expire_ringing(),
  public.create_call(uuid, uuid),
  public.answer_call(uuid, uuid, boolean),
  public.cancel_call(uuid, uuid),
  public.incoming_calls(uuid)
to service_role;

-- Ringing is pushed on the private Realtime channel user:<id>: each signed-in user may receive
-- only their own (the server sends with the service role). Skipped where Realtime is absent.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "user channel: receive own"
        on realtime.messages for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and (select realtime.topic()) = 'user:' || (select auth.uid())::text
        )
    $policy$;
  end if;
end
$$;
