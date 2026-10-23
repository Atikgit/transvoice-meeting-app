-- "Start meeting": the dashboard creates a meeting owned by the user, then opens its lobby.
-- Minutes are checked when the session starts (start_call_session), not here.

create function public.create_meeting(p_user uuid, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'NO_PROFILE';
  end if;
  insert into public.meetings (owner_id, title, room_name)
  values (p_user, nullif(trim(p_title), ''), 'm-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_meeting;
  return v_meeting;
end
$$;

revoke execute on function public.create_meeting(uuid, text) from public, anon, authenticated;
grant execute on function public.create_meeting(uuid, text) to service_role;
