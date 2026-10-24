-- Phase 2A: LiveKit webhooks → participant_segments (connected time per participant and payer).
-- Phase 3's minute meter reads these segments; nothing is billed here.

create table private.livekit_webhook_events (
  id text primary key,                 -- LiveKit WebhookEvent.id
  event text not null,
  session_id uuid,
  received_at timestamptz not null default now()
);
alter table private.livekit_webhook_events enable row level security;
revoke all on private.livekit_webhook_events from anon, authenticated;

-- At most one open segment per participant and session.
create unique index participant_segments_one_open
  on public.participant_segments (session_id, user_id) where disconnected_at is null;

-- Applies one webhook event. Returns 'duplicate' for a repeated event id, 'ignored' for events
-- that do not belong to a known session/participant, else 'ok'.
create function public.record_livekit_event(
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

revoke execute on function public.record_livekit_event(text, text, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_livekit_event(text, text, uuid, uuid, timestamptz)
  to service_role;
