-- Phase 3A: admit_participant ran on every LiveKit token request (a reconnect, "Retry", a page
-- reload) and its ON CONFLICT ... DO UPDATE reset the participant's spoken/listen language to
-- the profile defaults and the payer to whatever resolve_payer says today. That
--   * silently undid a language change made in the room (translation then went the wrong way),
--   * and would let a sponsorship window that expired mid-call move the guest's minutes to
--     themselves (decision 1: a call in progress is never affected by the window), or undo
--     "pay for myself" (decision 3).
-- The row is now written once, when the participant is first admitted to the session; later
-- token requests only check the rights and return the stored row. The lobby syncs the languages
-- it has just saved (see joinFromLobby), the room menu uses set_participant_langs.

create or replace function public.admit_participant(p_session uuid, p_user uuid)
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
  v_role := case when v_rights = 'host' then 'host' else 'guest' end;

  -- Already in this session: keep the stored payer and languages (they are fixed at join).
  -- Only a participant who has not been admitted yet needs minutes (when paying for themselves).
  if not exists (
    select 1 from public.meeting_participants mp
    where mp.session_id = p_session and mp.user_id = p_user
  ) then
    if v_rights = 'member' and not public.has_available_minutes(p_user) then
      raise exception 'NO_MINUTES';
    end if;
    v_payer := case when v_rights = 'host' then p_user else public.resolve_payer(v_session.meeting_id, p_user) end;
    insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
    select p_session, p_user, v_role, v_payer, p.spoken_lang, p.listen_lang
    from public.profiles p where p.id = p_user
    on conflict (session_id, user_id) do nothing;
  end if;

  return query
    select v_session.meeting_id, v_role, mp.payer_id, mp.spoken_lang, mp.listen_lang,
           coalesce(nullif(p.full_name, ''), 'Participant'), v_session.status
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.user_id
    where mp.session_id = p_session and mp.user_id = p_user;
end
$$;

revoke execute on function public.admit_participant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admit_participant(uuid, uuid) to service_role;
