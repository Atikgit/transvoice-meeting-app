-- Meeting room sessions: the room opens "ready" and only the host's Start makes a call_session
-- live (translation, timer). Service role only, called by the app's server actions.
-- Billing ticks (Phase 4) will read call_sessions / meeting_participants; payer per Rule 2/3.

-- Starts (or returns the already live) session of a meeting. Host only; needs minutes.
create function public.start_call_session(p_meeting uuid, p_user uuid)
returns table (session_id uuid, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_session uuid;
  v_started timestamptz;
begin
  select owner_id into v_owner from public.meetings where id = p_meeting for update;
  if not found then
    raise exception 'NO_MEETING';
  end if;
  if v_owner <> p_user then
    raise exception 'NOT_HOST';
  end if;

  select cs.id, cs.started_at into v_session, v_started
  from public.call_sessions cs
  where cs.meeting_id = p_meeting and cs.status = 'live'
  order by cs.created_at desc
  limit 1;
  if v_session is not null then
    return query select v_session, v_started;
    return;
  end if;

  if not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  insert into public.call_sessions (meeting_id, host_id, initiated_by, status, started_at)
  values (p_meeting, p_user, p_user, 'live', now())
  returning id, started_at into v_session, v_started;

  insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
  select v_session, p_user, 'host', p_user, p.spoken_lang, p.listen_lang
  from public.profiles p where p.id = p_user;

  return query select v_session, v_started;
end
$$;

-- Adds a participant to a live session. Payer (Rule 2/3): the sponsor of a valid sponsored
-- connection to this meeting, else the participant, who then needs their own minutes.
-- Returns 'host' or 'guest'. Idempotent.
create function public.join_call_session(p_session uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.call_sessions;
  v_role text;
  v_payer uuid;
begin
  select * into v_session from public.call_sessions where id = p_session;
  if not found or v_session.status <> 'live' then
    raise exception 'SESSION_NOT_LIVE';
  end if;
  if not private.can_view_meeting(v_session.meeting_id, p_user) then
    raise exception 'NOT_ALLOWED';
  end if;

  v_role := case when p_user = v_session.host_id then 'host' else 'guest' end;
  select sc.sponsor_id into v_payer
  from public.sponsored_connections sc
  where sc.meeting_id = v_session.meeting_id
    and sc.guest_id = p_user
    and sc.revoked_at is null
    and sc.expires_at > now()
  order by sc.expires_at desc
  limit 1;
  v_payer := coalesce(v_payer, p_user);

  if v_payer = p_user and not exists (
    select 1 from public.meeting_participants where session_id = p_session and user_id = p_user
  ) and not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
  select p_session, p_user, v_role, v_payer, p.spoken_lang, p.listen_lang
  from public.profiles p where p.id = p_user
  on conflict (session_id, user_id) do nothing;

  return v_role;
end
$$;

-- Ends a live session. Host only.
create function public.end_call_session(p_session uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.call_sessions
  set status = 'ended', ended_at = now(), end_reason = 'host_ended'
  where id = p_session and host_id = p_user and status = 'live';
  if not found then
    raise exception 'NOT_HOST_OR_NOT_LIVE';
  end if;
end
$$;

revoke execute on function public.start_call_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.join_call_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.end_call_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_call_session(uuid, uuid) to service_role;
grant execute on function public.join_call_session(uuid, uuid) to service_role;
grant execute on function public.end_call_session(uuid, uuid) to service_role;
