-- Phase 3B (10): segments are closed where the heartbeat stopped, never at "now".
--
--  * A session that is no longer open (ended / missed / declined) never keeps open segments: a
--    trigger closes them the moment its status leaves ready/live, whichever code path ended it
--    (host End, grace timer, sweeper, MAX_SESSION_HOURS, webhook).
--  * The sweeper closes segments left open in open sessions once their heartbeat is more than 3
--    minutes old (the tab crashed, the leave webhook was lost) - also at the last heartbeat.
-- Close time = the earlier of the session's end (or now) and the last heartbeat; a segment that
-- never sent a heartbeat closes at its own start and bills nothing.

create function private.close_time(
  p_connected_at timestamptz,
  p_last_heartbeat_at timestamptz,
  p_ended_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    p_connected_at,
    least(coalesce(p_ended_at, now()), coalesce(p_last_heartbeat_at, p_connected_at))
  )
$$;

create function private.close_segments_of_ended_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.participant_segments
  set disconnected_at = private.close_time(connected_at, last_heartbeat_at, new.ended_at)
  where session_id = new.id and disconnected_at is null;
  return new;
end
$$;

create trigger call_sessions_close_segments
  after update of status on public.call_sessions
  for each row
  when (new.status not in ('ready', 'live') and old.status in ('ready', 'live'))
  execute function private.close_segments_of_ended_session();

drop function public.sweep_orphans();
create function public.sweep_orphans()
returns table (segments_closed int, ringing_expired int, segments_stale int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segments int;
  v_stale int;
  v_ringing int;
begin
  -- Sessions that are no longer open (the trigger covers new endings; this covers older rows).
  with closed as (
    update public.participant_segments ps
    set disconnected_at = private.close_time(ps.connected_at, ps.last_heartbeat_at, cs.ended_at)
    from public.call_sessions cs
    where cs.id = ps.session_id
      and ps.disconnected_at is null
      and cs.status not in ('ready', 'live')
    returning 1
  )
  select count(*)::int into v_segments from closed;

  -- Open sessions: a segment with no heartbeat for 3 minutes is a crashed tab.
  with stale as (
    update public.participant_segments ps
    set disconnected_at = private.close_time(ps.connected_at, ps.last_heartbeat_at, null)
    from public.call_sessions cs
    where cs.id = ps.session_id
      and ps.disconnected_at is null
      and cs.status in ('ready', 'live')
      and coalesce(ps.last_heartbeat_at, ps.connected_at) < now() - interval '3 minutes'
    returning 1
  )
  select count(*)::int into v_stale from stale;

  v_ringing := public.expire_ringing();
  return query select v_segments, v_ringing, v_stale;
end
$$;

revoke execute on function public.sweep_orphans() from public, anon, authenticated;
grant execute on function public.sweep_orphans() to service_role;
