-- Phase 2A: call rights, LiveKit admission and the session lifecycle.
--
-- A meeting has at most one open session. It is created "ready" when someone with call rights
-- opens the room (so the LiveKit room and tokens exist before Start), goes "live" on the host's
-- Start and "ended" on End / reconnect timeout / room_finished. Guest-initiated calls start as
-- "ringing" (see 20261024000200). All functions: service role only.

alter table public.call_sessions drop constraint call_sessions_status_check;
alter table public.call_sessions add constraint call_sessions_status_check
  check (status in ('ringing', 'ready', 'live', 'ended', 'missed', 'declined'));
alter table public.call_sessions alter column status set default 'ready';

create unique index call_sessions_one_open_per_meeting
  on public.call_sessions (meeting_id) where status in ('ready', 'live');

-- Who may take part in a meeting's calls (Rules 1–3):
--   'host'       meeting owner
--   'sponsored'  guest with a valid (unexpired, unrevoked) sponsored connection to this meeting
--   'member'     anyone else who can see the meeting (expired sponsorship, past participant);
--                joins only as a self-payer with available minutes
--   null         no rights
create function public.call_rights(p_meeting uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.owner_id = p_user then 'host'
    when exists (
      select 1 from public.sponsored_connections sc
      where sc.meeting_id = p_meeting and sc.guest_id = p_user
        and sc.revoked_at is null and sc.expires_at > now()
    ) then 'sponsored'
    when private.can_view_meeting(p_meeting, p_user) then 'member'
  end
  from public.meetings m
  where m.id = p_meeting
$$;

-- Rule 2: the sponsor of a valid sponsored connection pays for the guest; everyone else pays
-- for themselves.
create function public.resolve_payer(p_meeting uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select sc.sponsor_id from public.sponsored_connections sc
      where sc.meeting_id = p_meeting and sc.guest_id = p_user
        and sc.revoked_at is null and sc.expires_at > now()
      order by sc.expires_at desc
      limit 1
    ),
    p_user
  )
$$;

-- The meeting's open session, created "ready" if there is none.
create function public.open_call_session(p_meeting uuid, p_user uuid)
returns table (session_id uuid, status text, started_at timestamptz, host_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner uuid;
begin
  if public.call_rights(p_meeting, p_user) is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select owner_id into v_owner from public.meetings where id = p_meeting;

  insert into public.call_sessions (meeting_id, host_id, initiated_by, status)
  values (p_meeting, v_owner, p_user, 'ready')
  on conflict (meeting_id) where status in ('ready', 'live') do nothing;

  return query
    select cs.id, cs.status, cs.started_at, cs.host_id
    from public.call_sessions cs
    where cs.meeting_id = p_meeting and cs.status in ('ready', 'live');
end
$$;

-- Token gate for /api/livekit/token: checks rights, records the participant and their payer.
create function public.admit_participant(p_session uuid, p_user uuid)
returns table (
  meeting_id uuid,
  role text,
  payer_id uuid,
  spoken_lang text,
  listen_lang text,
  display_name text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.call_sessions;
  v_rights text;
  v_payer uuid;
  v_role text;
begin
  select * into v_session from public.call_sessions where id = p_session;
  if not found then
    raise exception 'NO_SESSION';
  end if;
  if v_session.status not in ('ready', 'live') then
    raise exception 'SESSION_CLOSED';
  end if;

  v_rights := public.call_rights(v_session.meeting_id, p_user);
  if v_rights is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_rights = 'member' and not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  v_role := case when v_rights = 'host' then 'host' else 'guest' end;
  v_payer := case when v_rights = 'host' then p_user else public.resolve_payer(v_session.meeting_id, p_user) end;

  insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
  select p_session, p_user, v_role, v_payer, p.spoken_lang, p.listen_lang
  from public.profiles p where p.id = p_user
  on conflict (session_id, user_id) do update
    set payer_id = excluded.payer_id,
        spoken_lang = excluded.spoken_lang,
        listen_lang = excluded.listen_lang;

  return query
    select v_session.meeting_id, v_role, v_payer, p.spoken_lang, p.listen_lang,
           coalesce(nullif(p.full_name, ''), 'Participant'), v_session.status
    from public.profiles p where p.id = p_user;
end
$$;

-- Start and End now act on a session (Phase 1.1 started by meeting id).
drop function public.start_call_session(uuid, uuid);
drop function public.end_call_session(uuid, uuid);
drop function public.join_call_session(uuid, uuid);

-- Host presses Start: ready → live. Idempotent while live. Needs available minutes.
create function public.start_call_session(p_session uuid, p_user uuid)
returns table (session_id uuid, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.call_sessions;
begin
  select * into v_session from public.call_sessions where id = p_session for update;
  if not found then
    raise exception 'NO_SESSION';
  end if;
  if v_session.host_id <> p_user then
    raise exception 'NOT_HOST';
  end if;
  if v_session.status = 'live' then
    return query select v_session.id, v_session.started_at;
    return;
  end if;
  if v_session.status <> 'ready' then
    raise exception 'SESSION_CLOSED';
  end if;
  if not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  update public.call_sessions set status = 'live', started_at = now()
  where id = p_session;

  insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
  select p_session, p_user, 'host', p_user, p.spoken_lang, p.listen_lang
  from public.profiles p where p.id = p_user
  on conflict (session_id, user_id) do nothing;

  return query select cs.id, cs.started_at from public.call_sessions cs where cs.id = p_session;
end
$$;

-- Ends a ready or live session. p_user = the host (End meeting), or null for the server
-- (reconnect timeout, room finished). Returns false if it was already closed.
create function public.end_call_session(p_session uuid, p_user uuid, p_reason text default 'host_ended')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
begin
  select host_id into v_host from public.call_sessions where id = p_session;
  if not found then
    raise exception 'NO_SESSION';
  end if;
  if p_user is not null and p_user <> v_host then
    raise exception 'NOT_HOST';
  end if;
  update public.call_sessions
  set status = 'ended', ended_at = now(), end_reason = p_reason
  where id = p_session and status in ('ready', 'live');
  return found;
end
$$;

revoke execute on function
  public.call_rights(uuid, uuid),
  public.resolve_payer(uuid, uuid),
  public.open_call_session(uuid, uuid),
  public.admit_participant(uuid, uuid),
  public.start_call_session(uuid, uuid),
  public.end_call_session(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.call_rights(uuid, uuid),
  public.resolve_payer(uuid, uuid),
  public.open_call_session(uuid, uuid),
  public.admit_participant(uuid, uuid),
  public.start_call_session(uuid, uuid),
  public.end_call_session(uuid, uuid, text)
to service_role;
