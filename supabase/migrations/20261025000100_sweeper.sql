-- Phase 2C: periodic sweeper. Service role only; every statement is idempotent so overlapping
-- runs (or a restart in the middle of one) are harmless.

-- Open sessions that may have lost everyone: older than p_older_than and still ready/live.
-- The server then asks LiveKit who is present and ends the abandoned ones (lib/sweeper.ts).
create function public.stale_open_sessions(p_older_than interval)
returns table (session_id uuid, host_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select cs.id, cs.host_id, cs.status
  from public.call_sessions cs
  where cs.status in ('ready', 'live')
    and coalesce(cs.started_at, cs.created_at) < now() - p_older_than
  order by cs.created_at
  limit 200;
$$;

-- Closes segments left open on sessions that are no longer open (missed webhook, crash), and
-- marks ringing calls that nobody answered as missed. Returns the number of rows touched.
create function public.sweep_orphans()
returns table (segments_closed int, ringing_expired int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segments int;
  v_ringing int;
begin
  with closed as (
    update public.participant_segments ps
    set disconnected_at = greatest(ps.connected_at, coalesce(cs.ended_at, now()))
    from public.call_sessions cs
    where cs.id = ps.session_id
      and ps.disconnected_at is null
      and cs.status not in ('ready', 'live')
    returning 1
  )
  select count(*)::int into v_segments from closed;

  v_ringing := public.expire_ringing();
  return query select v_segments, v_ringing;
end
$$;

revoke execute on function public.stale_open_sessions(interval), public.sweep_orphans()
from public, anon, authenticated;
grant execute on function public.stale_open_sessions(interval), public.sweep_orphans()
to service_role;
