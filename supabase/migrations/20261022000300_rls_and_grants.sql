-- Row Level Security and privileges.
--
-- Baseline: anon gets nothing; authenticated gets SELECT on tables it may read (rows filtered by
-- RLS) and UPDATE only on the editable profile columns. Every other write goes through route
-- handlers using the service role or SECURITY DEFINER functions. Later migrations that add
-- tables must repeat this pattern (a test audits the grants).

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.meetings enable row level security;
alter table public.invitations enable row level security;
alter table public.sponsored_connections enable row level security;
alter table public.connections enable row level security;
alter table public.call_sessions enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.participant_segments enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.chat_messages enable row level security;
alter table public.transcripts enable row level security;
alter table public.payment_events enable row level security;

alter table private.app_settings enable row level security;
alter table private.trial_grants enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

grant select on
  public.profiles,
  public.billing_accounts,
  public.meetings,
  public.sponsored_connections,
  public.connections,
  public.call_sessions,
  public.meeting_participants,
  public.participant_segments,
  public.usage_ledger,
  public.chat_messages,
  public.transcripts
to authenticated;

-- The token hash is never readable by clients.
grant select (
  id, meeting_id, inviter_id, email, max_uses, used_count, sponsor_window, expires_at, revoked_at, created_at
) on public.invitations to authenticated;

grant update (
  full_name, headline, linkedin_url, spoken_lang, listen_lang, voice_gender, original_audio_mode
) on public.profiles to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function
  private.is_session_participant(uuid, uuid),
  private.can_view_meeting(uuid, uuid),
  private.can_view_profile(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Policies (SELECT unless noted). auth.uid() is wrapped in a subquery so it is evaluated once.
-- ---------------------------------------------------------------------------

create policy "profiles: visible to self, connections and call partners"
  on public.profiles for select to authenticated
  using (private.can_view_profile(id, (select auth.uid())));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "billing_accounts: own"
  on public.billing_accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "meetings: owner, sponsored guests and participants"
  on public.meetings for select to authenticated
  using (private.can_view_meeting(id, (select auth.uid())));

create policy "invitations: own"
  on public.invitations for select to authenticated
  using (inviter_id = (select auth.uid()));

create policy "sponsored_connections: sponsor or guest"
  on public.sponsored_connections for select to authenticated
  using (sponsor_id = (select auth.uid()) or guest_id = (select auth.uid()));

create policy "connections: own"
  on public.connections for select to authenticated
  using (user_id = (select auth.uid()));

create policy "call_sessions: host, caller and participants"
  on public.call_sessions for select to authenticated
  using (
    host_id = (select auth.uid())
    or initiated_by = (select auth.uid())
    or private.is_session_participant(id, (select auth.uid()))
  );

create policy "meeting_participants: co-participants"
  on public.meeting_participants for select to authenticated
  using (private.is_session_participant(session_id, (select auth.uid())));

create policy "participant_segments: own or as payer"
  on public.participant_segments for select to authenticated
  using (user_id = (select auth.uid()) or payer_id = (select auth.uid()));

create policy "usage_ledger: as payer"
  on public.usage_ledger for select to authenticated
  using (payer_id = (select auth.uid()));

create policy "chat_messages: sender, recipient or meeting member"
  on public.chat_messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (meeting_id is not null and private.can_view_meeting(meeting_id, (select auth.uid())))
  );

create policy "transcripts: session participants"
  on public.transcripts for select to authenticated
  using (private.is_session_participant(session_id, (select auth.uid())));

-- api_usage_events, payment_events, private.*: no policies → no client access.
