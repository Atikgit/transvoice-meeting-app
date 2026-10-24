-- Phase 2B: change spoken / listen language from inside the room ("Live translation" menu).
-- meeting_participants is what /api/translate reads for every utterance, so the change takes
-- effect on the next one. It is a session setting: the profile is not touched. Service role only.

create function public.set_participant_langs(
  p_session uuid,
  p_user uuid,
  p_spoken text default null,
  p_listen text default null
)
returns table (display_name text, role text, spoken_lang text, listen_lang text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format constant text := '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?(-[a-z]{4,8})?$';
begin
  if (p_spoken is not null and p_spoken !~ v_format) or (p_listen is not null and p_listen !~ v_format) then
    raise exception 'INVALID_LANGUAGE';
  end if;
  if not exists (
    select 1 from public.call_sessions cs
    where cs.id = p_session and cs.status in ('ready', 'live')
  ) then
    raise exception 'SESSION_CLOSED';
  end if;

  update public.meeting_participants mp
  set spoken_lang = coalesce(p_spoken, mp.spoken_lang),
      listen_lang = coalesce(p_listen, mp.listen_lang)
  where mp.session_id = p_session and mp.user_id = p_user;
  if not found then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  return query
    select coalesce(nullif(p.full_name, ''), 'Participant'), mp.role, mp.spoken_lang, mp.listen_lang
    from public.meeting_participants mp
    left join public.profiles p on p.id = mp.user_id
    where mp.session_id = p_session and mp.user_id = p_user;
end
$$;

revoke execute on function public.set_participant_langs(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_participant_langs(uuid, uuid, text, text) to service_role;
