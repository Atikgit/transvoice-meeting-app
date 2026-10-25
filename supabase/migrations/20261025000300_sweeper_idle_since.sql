-- fix-room-session: the sweeper needs to know how long an open session has been idle, so a
-- "ready" session (someone is still connecting or waiting) is left alone for longer than a
-- live one. Adds idle_since = started_at (live) or created_at (ready).
drop function public.stale_open_sessions(interval);
create function public.stale_open_sessions(p_older_than interval)
returns table (session_id uuid, host_id uuid, status text, idle_since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select cs.id, cs.host_id, cs.status, coalesce(cs.started_at, cs.created_at)
  from public.call_sessions cs
  where cs.status in ('ready', 'live')
    and coalesce(cs.started_at, cs.created_at) < now() - p_older_than
  order by cs.created_at
  limit 200;
$$;

revoke execute on function public.stale_open_sessions(interval) from public, anon, authenticated;
grant execute on function public.stale_open_sessions(interval) to service_role;
