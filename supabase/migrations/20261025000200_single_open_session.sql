-- fix-room-session: one meeting, at most ONE open (ready/live) session, always the same one.
--
-- 1. open_call_session serialises concurrent openers on the meeting row and reports whether it
--    created the session or reused the existing one. The partial unique index
--    call_sessions_one_open_per_meeting (20261024000100) stays as the hard backstop.
-- 2. create_invitation without a meeting no longer opens a brand-new meeting every time: it
--    reuses the host's current meeting (one with an open session, or one created in the last
--    6 hours that has not had a session yet). Otherwise a guest who accepts a link made from the
--    dashboard lands in a different meeting from the one the host is already live in.

drop function public.open_call_session(uuid, uuid);
create function public.open_call_session(p_meeting uuid, p_user uuid)
returns table (session_id uuid, status text, started_at timestamptz, host_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_session public.call_sessions;
  v_created boolean := false;
begin
  if public.call_rights(p_meeting, p_user) is null then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Concurrent openers (host and guest, two guests, a double click) queue here, so only the
  -- first one inserts and the others read its row.
  select owner_id into v_owner from public.meetings where id = p_meeting for update;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_session from public.call_sessions
  where meeting_id = p_meeting and status in ('ready', 'live');

  if not found then
    insert into public.call_sessions (meeting_id, host_id, initiated_by, status)
    values (p_meeting, v_owner, p_user, 'ready')
    on conflict (meeting_id) where status in ('ready', 'live') do nothing
    returning * into v_session;
    v_created := found;
    if not found then -- lost a race the lock did not cover: take the winner's row
      select * into v_session from public.call_sessions
      where meeting_id = p_meeting and status in ('ready', 'live');
    end if;
  end if;

  return query select v_session.id, v_session.status, v_session.started_at, v_session.host_id, v_created;
end
$$;

revoke execute on function public.open_call_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_call_session(uuid, uuid) to service_role;

-- The meeting a host is "in": prefers one with an open session, else a fresh one that has not
-- had a session yet. Null when there is none (the caller then creates a meeting).
create function private.current_meeting(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.meetings m
  where m.owner_id = p_user
    and (
      exists (select 1 from public.call_sessions cs
              where cs.meeting_id = m.id and cs.status in ('ready', 'live'))
      or (m.created_at > now() - interval '6 hours'
          and not exists (select 1 from public.call_sessions cs where cs.meeting_id = m.id))
    )
  order by exists (select 1 from public.call_sessions cs
                   where cs.meeting_id = m.id and cs.status in ('ready', 'live')) desc,
           m.created_at desc
  limit 1
$$;

drop function public.create_invitation(uuid, text, interval, uuid);
create function public.create_invitation(
  p_user uuid,
  p_token_hash text,
  p_window interval default interval '7 days',
  p_meeting uuid default null
)
returns table (meeting_id uuid, invitation_id uuid, expires_at timestamptz, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting uuid := p_meeting;
  v_reused boolean := p_meeting is not null;
  v_invitation uuid;
  v_expires timestamptz := now() + p_window;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN_HASH';
  end if;
  if not private.has_verified_email(p_user) then
    raise exception 'EMAIL_NOT_VERIFIED';
  end if;
  if not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  if v_meeting is null then
    v_meeting := private.current_meeting(p_user);
    v_reused := v_meeting is not null;
  end if;

  if v_meeting is null then
    insert into public.meetings (owner_id, room_name)
    values (p_user, 'm-' || replace(gen_random_uuid()::text, '-', ''))
    returning id into v_meeting;
  elsif not private.can_view_meeting(v_meeting, p_user) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.invitations (meeting_id, inviter_id, token_hash, sponsor_window, expires_at)
  values (v_meeting, p_user, p_token_hash, p_window, v_expires)
  returning id into v_invitation;

  return query select v_meeting, v_invitation, v_expires, v_reused;
end
$$;

revoke execute on function public.create_invitation(uuid, text, interval, uuid)
  from public, anon, authenticated;
grant execute on function public.create_invitation(uuid, text, interval, uuid) to service_role;
