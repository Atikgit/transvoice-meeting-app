-- Phase 2B: what /api/translate needs per utterance, in one call. Service role only.
--
-- Listener languages come from meeting_participants (the source of truth; the room's
-- "Live translation" dropdown updates them, see set_listen_lang). Who is connected right now
-- comes from LiveKit (the route intersects both).

create function public.translation_context(p_session uuid, p_speaker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.call_sessions;
  v_speaker public.meeting_participants;
begin
  select * into v_session from public.call_sessions where id = p_session;
  if not found then
    raise exception 'NO_SESSION';
  end if;
  if v_session.status <> 'live' then
    raise exception 'SESSION_NOT_LIVE';
  end if;
  select * into v_speaker from public.meeting_participants
  where session_id = p_session and user_id = p_speaker;
  if not found then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  return jsonb_build_object(
    'hostId', v_session.host_id,
    'hostEmail', (select u.email from auth.users u where u.id = v_session.host_id),
    'speaker', jsonb_build_object(
      'userId', v_speaker.user_id,
      'spokenLang', v_speaker.spoken_lang,
      'payerId', v_speaker.payer_id,
      'payerHasMinutes', public.has_available_minutes(v_speaker.payer_id),
      -- "My translated voice" in Settings: how listeners hear this speaker.
      'voiceGender', coalesce((select p.voice_gender from public.profiles p where p.id = p_speaker), 'female')
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('userId', mp.user_id, 'listenLang', mp.listen_lang))
      from public.meeting_participants mp
      where mp.session_id = p_session and mp.user_id <> p_speaker
    ), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.translation_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.translation_context(uuid, uuid) to service_role;
