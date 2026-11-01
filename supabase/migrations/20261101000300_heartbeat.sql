-- Phase 3B (7): client heartbeat. POST /api/heartbeat (every 20 s from the room page) calls
-- record_heartbeat; the tick reads the heartbeat through segment_effective_end.
--
-- Effective end of a segment inside a bucket:
--   coalesce(disconnected_at, least(bucket_end, last_heartbeat_at + 45 s))
-- so a tab that crashed (no webhook, no more heartbeats) stops being billed 45 s after its last
-- heartbeat, while a connected tab (heartbeat every 20 s) is billed to the end of every bucket.

create function private.heartbeat_grace()
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(secs => coalesce(
    (select (value #>> '{}')::numeric from private.app_settings where key = 'segment_heartbeat_grace_seconds'),
    45))
$$;

create function private.segment_effective_end(
  p_connected_at timestamptz,
  p_disconnected_at timestamptz,
  p_last_heartbeat_at timestamptz,
  p_bucket_end timestamptz
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_disconnected_at,
    least(p_bucket_end, coalesce(p_last_heartbeat_at, p_connected_at) + private.heartbeat_grace())
  )
$$;

-- Updates the user's open segment. Returns
--   'ok'          heartbeat recorded;
--   'reconnected' the previous segment had gone silent for longer than the grace (sleep, network
--                 loss, our own outage): it is closed where the grace ran out and a new segment
--                 opens now, so the silent gap is never billed;
--   'no_segment'  nothing open for this user (the join webhook has not arrived, or they left);
--   'session_closed' the session is not ready/live.
create function public.record_heartbeat(p_session uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_seg public.participant_segments;
  v_last timestamptz;
begin
  select status into v_status from public.call_sessions where id = p_session;
  if v_status is null or v_status not in ('ready', 'live') then
    return 'session_closed';
  end if;

  select * into v_seg from public.participant_segments
  where session_id = p_session and user_id = p_user and disconnected_at is null
  for update;
  if not found then
    return 'no_segment';
  end if;

  v_last := coalesce(v_seg.last_heartbeat_at, v_seg.connected_at);
  if now() - v_last > private.heartbeat_grace() then
    update public.participant_segments
    set disconnected_at = greatest(connected_at, v_last + private.heartbeat_grace())
    where id = v_seg.id;
    insert into public.participant_segments (session_id, user_id, payer_id, connected_at, last_heartbeat_at)
    values (p_session, p_user, v_seg.payer_id, now(), now());
    return 'reconnected';
  end if;

  update public.participant_segments set last_heartbeat_at = now() where id = v_seg.id;
  return 'ok';
end
$$;

revoke execute on function public.record_heartbeat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_heartbeat(uuid, uuid) to service_role;

-- A join webhook for a user whose previous segment is still open and silent (the tab crashed, no
-- left event) must not revive that segment: the heartbeat of the new connection would otherwise
-- make the whole gap billable. Close the silent one at its effective end, then open a new one.
create or replace function public.record_livekit_event(
  p_event_id text,
  p_event text,
  p_session uuid,
  p_user uuid,
  p_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_meeting uuid;
  v_payer uuid;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'EVENT_ID_REQUIRED';
  end if;
  insert into private.livekit_webhook_events (id, event, session_id)
  values (p_event_id, p_event, p_session)
  on conflict (id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;

  select meeting_id into v_meeting from public.call_sessions where id = p_session;
  if v_meeting is null then
    return 'ignored';
  end if;

  if p_event = 'participant_joined' then
    if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
      return 'ignored';
    end if;
    update public.participant_segments
    set disconnected_at = greatest(
      connected_at,
      least(p_at, coalesce(last_heartbeat_at, connected_at) + private.heartbeat_grace())
    )
    where session_id = p_session and user_id = p_user and disconnected_at is null
      and coalesce(last_heartbeat_at, connected_at) + private.heartbeat_grace() < p_at;
    -- The payer recorded when the token was issued (admit_participant), else Rule 2.
    select payer_id into v_payer from public.meeting_participants
    where session_id = p_session and user_id = p_user;
    v_payer := coalesce(v_payer, public.resolve_payer(v_meeting, p_user));
    insert into public.participant_segments (session_id, user_id, payer_id, connected_at, last_heartbeat_at)
    values (p_session, p_user, v_payer, p_at, p_at)
    on conflict (session_id, user_id) where disconnected_at is null do nothing;
    return 'ok';
  end if;

  if p_event = 'participant_left' then
    update public.participant_segments
    set disconnected_at = greatest(connected_at, p_at)
    where session_id = p_session and user_id = p_user and disconnected_at is null;
    return 'ok';
  end if;

  if p_event = 'room_finished' then
    update public.participant_segments
    set disconnected_at = greatest(connected_at, p_at)
    where session_id = p_session and disconnected_at is null;
    update public.call_sessions
    set status = 'ended', ended_at = now(), end_reason = 'room_finished'
    where id = p_session and status in ('ready', 'live');
    return 'ok';
  end if;

  return 'ignored';
end
$$;
