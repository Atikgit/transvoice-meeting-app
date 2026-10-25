-- fix-audio-invite 2: "Call" rings the other person in BOTH directions.
--
-- Until now only a sponsored guest calling their sponsor created a 'ringing' session; the host
-- pressing Call got 'direct' (straight to the lobby) and nobody was ever rung. In production no
-- ringing session had ever been created. Now the host's Call rings the meeting's guest (the
-- latest non-revoked sponsored connection of that meeting), whether or not a session is already
-- open (the host is usually in the room alone): the guest's Accept joins that open session
-- (answer_call already merges a ringing session into an open one). The guest's Call is unchanged:
-- if a session is open they join it, else the sponsor is rung.

create or replace function public.create_call(p_meeting uuid, p_caller uuid)
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
    -- Ring the guest of this meeting. Nobody to ring (no connection yet): straight to the lobby.
    select sc.guest_id into v_callee from public.sponsored_connections sc
    where sc.meeting_id = p_meeting and sc.sponsor_id = p_caller and sc.revoked_at is null
    order by sc.expires_at desc limit 1;
    if v_callee is null then
      return query select 'direct'::text, p_meeting, null::uuid, null::uuid, null::timestamptz;
      return;
    end if;
  else
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

-- The incoming-call modal needs to know who is calling whom: a host calling a guest, or a guest
-- calling their sponsor (who pays).
drop function public.incoming_calls(uuid);
create function public.incoming_calls(p_user uuid)
returns table (
  session_id uuid,
  meeting_id uuid,
  caller_id uuid,
  caller_name text,
  expires_at timestamptz,
  from_host boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.expire_ringing();
  return query
    select cs.id, cs.meeting_id, cs.initiated_by, coalesce(nullif(p.full_name, ''), 'Your partner'),
           cs.created_at + private.ring_timeout(), cs.initiated_by = cs.host_id
    from public.call_sessions cs
    join public.profiles p on p.id = cs.initiated_by
    where cs.callee_id = p_user and cs.status = 'ringing'
    order by cs.created_at desc;
end
$$;

revoke execute on function public.create_call(uuid, uuid), public.incoming_calls(uuid)
  from public, anon, authenticated;
grant execute on function public.create_call(uuid, uuid), public.incoming_calls(uuid) to service_role;

-- The private user:<id> Realtime channel needs this policy to deliver anything. It was created by
-- 20261024000200 (verified present in production); re-asserted here so a database that lost it
-- (restore, manual cleanup) is repaired by the next `db push`.
do $$
begin
  if to_regclass('realtime.messages') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'user channel: receive own'
     ) then
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
