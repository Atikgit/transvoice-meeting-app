-- Core schema (docs/PROMPT.md §5). RLS and grants live in a later migration.
--
-- Changes from the §5 sketch:
-- * billing_accounts splits trial_minutes_remaining (never expire) from prepaid_minutes_remaining
--   (subscription allotment, reset at each renewal, no rollover). Debits use prepaid first.
-- * private.trial_grants enforces one free trial per verified, normalized email, even after the
--   account is deleted.
-- * profiles.original_audio_mode, invitations.sponsor_window, meetings.locked, payer FKs and
--   CHECK constraints added; usage_ledger gains per-bucket columns and an 'expire' kind.

create schema if not exists private;
revoke all on schema private from public;

-- Server-side settings that SQL functions need (single source of truth).
create table private.app_settings (
  key text primary key,
  value jsonb not null
);
insert into private.app_settings (key, value) values ('free_trial_minutes', '15');

create table private.trial_grants (
  email_hash text primary key,          -- sha256 of the normalized email
  user_id uuid not null unique,         -- no FK: the grant outlives the account
  granted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  avatar_url text check (char_length(avatar_url) <= 2048),
  headline text check (char_length(headline) <= 160),
  linkedin_url text check (linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/'),
  spoken_lang text not null default 'en-US' check (spoken_lang ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  listen_lang text not null default 'en-US' check (listen_lang ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  voice_gender text not null default 'female' check (voice_gender in ('male', 'female')),
  original_audio_mode text not null default 'duck'
    check (original_audio_mode in ('off', 'duck', 'mute')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  billing_type text not null default 'free' check (billing_type in ('free', 'prepaid', 'postpaid')),
  plan text not null default 'trial',
  trial_minutes_remaining numeric(12, 4) not null default 0 check (trial_minutes_remaining >= 0),
  prepaid_minutes_remaining numeric(12, 4) not null default 0 check (prepaid_minutes_remaining >= 0),
  postpaid_minutes_accrued numeric(12, 4) not null default 0 check (postpaid_minutes_accrued >= 0),
  postpaid_credit_limit_minutes numeric(12, 4) check (postpaid_credit_limit_minutes > 0),
  ls_customer_id text,
  ls_subscription_id text unique,
  ls_subscription_item_id text,
  ls_variant_id bigint,
  period_start timestamptz,
  period_end timestamptz,
  status text not null default 'active'
    check (status in ('active', 'on_trial', 'past_due', 'paused', 'unpaid', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Meetings, invitations, sponsorship
-- ---------------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text check (char_length(title) <= 120),
  room_name text not null unique,
  max_participants int not null default 8 check (max_participants between 2 and 8),
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
create index meetings_owner_idx on public.meetings (owner_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  email text,
  max_uses int not null default 1 check (max_uses > 0),
  used_count int not null default 0 check (used_count >= 0 and used_count <= max_uses),
  sponsor_window interval not null default interval '7 days'
    check (sponsor_window in (interval '1 hour', interval '24 hours', interval '7 days', interval '30 days')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_inviter_idx on public.invitations (inviter_id);

create table public.sponsored_connections (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.profiles (id) on delete cascade,
  guest_id uuid not null references public.profiles (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  invitation_id uuid references public.invitations (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (sponsor_id <> guest_id),
  unique (sponsor_id, guest_id, invitation_id)
);
create index sponsored_connections_guest_idx on public.sponsored_connections (guest_id);

create table public.connections (
  user_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.profiles (id) on delete cascade,
  source text not null default 'invitation' check (source in ('invitation', 'manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id),
  check (user_id <> contact_id)
);
create index connections_contact_idx on public.connections (contact_id);

-- ---------------------------------------------------------------------------
-- Calls and metering
-- ---------------------------------------------------------------------------

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  host_id uuid not null references public.profiles (id) on delete cascade,
  initiated_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing', 'live', 'ended', 'missed', 'declined')),
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index call_sessions_meeting_idx on public.call_sessions (meeting_id);
create index call_sessions_host_idx on public.call_sessions (host_id);

create table public.meeting_participants (
  session_id uuid not null references public.call_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  payer_id uuid not null references public.profiles (id) on delete cascade,
  sponsored_connection_id uuid references public.sponsored_connections (id) on delete set null,
  spoken_lang text not null,
  listen_lang text not null,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index meeting_participants_user_idx on public.meeting_participants (user_id);

create table public.participant_segments (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.call_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  payer_id uuid not null references public.profiles (id) on delete cascade,
  connected_at timestamptz not null,
  disconnected_at timestamptz,
  last_heartbeat_at timestamptz,
  check (disconnected_at is null or disconnected_at >= connected_at)
);
create index participant_segments_open_idx
  on public.participant_segments (session_id) where disconnected_at is null;
create index participant_segments_payer_idx on public.participant_segments (payer_id);

create table public.usage_ledger (
  id bigint generated always as identity primary key,
  payer_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.call_sessions (id) on delete set null,
  participant_id uuid,
  minute_bucket timestamptz,
  lang_multiplier int check (lang_multiplier >= 1),
  billed_minutes numeric(12, 4) not null,
  trial_minutes numeric(12, 4) not null default 0,     -- portion taken from / added to the trial bucket
  prepaid_minutes numeric(12, 4) not null default 0,   -- portion taken from / added to the prepaid bucket
  billing_type text not null check (billing_type in ('free', 'prepaid', 'postpaid')),
  kind text not null check (kind in ('debit', 'accrual', 'credit', 'refund', 'expire')),
  synced_to_ls_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  -- Idempotent minute ticks. Rows without a session (credits, legacy debits) never conflict.
  constraint usage_ledger_idempotency_key unique (session_id, participant_id, minute_bucket, kind)
);
create index usage_ledger_payer_idx on public.usage_ledger (payer_id, created_at desc);

create table public.api_usage_events (
  id bigint generated always as identity primary key,
  request_id text not null unique,
  session_id uuid,
  speaker_id uuid,
  target_lang text,
  speech_seconds numeric(10, 3) not null check (speech_seconds >= 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chat, transcripts, payments
-- ---------------------------------------------------------------------------

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  attachment_path text,
  created_at timestamptz not null default now(),
  check (meeting_id is not null or recipient_id is not null)
);
create index chat_messages_meeting_idx on public.chat_messages (meeting_id, created_at);
create index chat_messages_dm_idx on public.chat_messages (sender_id, recipient_id, created_at);

create table public.transcripts (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.call_sessions (id) on delete cascade,
  speaker_id uuid not null references public.profiles (id) on delete cascade,
  src_lang text,
  original_text text not null,
  translations jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index transcripts_session_idx on public.transcripts (session_id, created_at);

create table public.payment_events (
  id text primary key,                  -- '<event_name>:<lemon squeezy object id>'
  user_id uuid references public.profiles (id) on delete set null,
  variant_id bigint,
  event_name text not null,
  minutes int,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
