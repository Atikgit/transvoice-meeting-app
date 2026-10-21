-- Functions and auth triggers. All SECURITY DEFINER functions pin search_path to ''.
-- Execute rights are set in the RLS/grants migration: business functions are service_role only;
-- private.* RLS helpers are callable by authenticated.

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger billing_accounts_touch_updated_at
  before update on public.billing_accounts
  for each row execute function private.touch_updated_at();

-- Lowercase, drop "+tag", and ignore dots for Gmail, so aliases share one trial.
create function private.normalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local text := split_part(lower(trim(p_email)), '@', 1);
  v_domain text := split_part(lower(trim(p_email)), '@', 2);
begin
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER to avoid policy recursion)
-- ---------------------------------------------------------------------------

create function private.is_session_participant(p_session uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_participants
    where session_id = p_session and user_id = p_user
  )
$$;

create function private.can_view_meeting(p_meeting uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.meetings where id = p_meeting and owner_id = p_user)
    or exists (
      select 1 from public.sponsored_connections
      where meeting_id = p_meeting and guest_id = p_user and revoked_at is null
    )
    or exists (
      select 1
      from public.meeting_participants mp
      join public.call_sessions cs on cs.id = mp.session_id
      where cs.meeting_id = p_meeting and mp.user_id = p_user
    )
$$;

-- Own profile, connections, and people you have shared a call with.
create function private.can_view_profile(p_profile uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile = p_user
    or exists (
      select 1 from public.connections where user_id = p_user and contact_id = p_profile
    )
    or exists (
      select 1
      from public.meeting_participants a
      join public.meeting_participants b on b.session_id = a.session_id
      where a.user_id = p_user and b.user_id = p_profile
    )
$$;

-- ---------------------------------------------------------------------------
-- Trial minutes and signup
-- ---------------------------------------------------------------------------

-- Grants the free trial once per normalized email. Returns true if minutes were added.
create function private.grant_trial(p_user uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric := (select value::numeric from private.app_settings where key = 'free_trial_minutes');
  v_hash text;
  v_billing_type text;
begin
  if p_email is null or p_email = '' or coalesce(v_minutes, 0) <= 0 then
    return false;
  end if;

  insert into private.trial_grants (email_hash, user_id)
  values (encode(sha256(convert_to(private.normalize_email(p_email), 'UTF8')), 'hex'), p_user)
  on conflict do nothing
  returning email_hash into v_hash;

  if v_hash is null then
    return false;
  end if;

  update public.billing_accounts
  set trial_minutes_remaining = trial_minutes_remaining + v_minutes
  where user_id = p_user
  returning billing_type into v_billing_type;

  insert into public.usage_ledger (payer_id, billed_minutes, trial_minutes, billing_type, kind, reason)
  values (p_user, v_minutes, v_minutes, v_billing_type, 'credit', 'free_trial');

  return true;
end
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    left(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), 2048)
  );
  insert into public.billing_accounts (user_id) values (new.id);

  -- OAuth signups arrive already verified; email signups get the trial on confirmation.
  if new.email_confirmed_at is not null then
    perform private.grant_trial(new.id, new.email);
  end if;
  return new;
end
$$;

create function private.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.grant_trial(new.id, new.email);
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_user_email_confirmed();

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------

create function public.has_available_minutes(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when billing_type = 'postpaid' then
        status = 'active'
        and (postpaid_credit_limit_minutes is null or postpaid_minutes_accrued < postpaid_credit_limit_minutes)
      else trial_minutes_remaining + prepaid_minutes_remaining > 0
    end
    from public.billing_accounts
    where user_id = p_user
  ), false)
$$;

-- Debits a payer (prepaid bucket first, then trial; postpaid accrues). Idempotent when a
-- (session, participant, bucket) key is given. Returns the minutes actually covered; less than
-- requested means the payer ran out.
create function public.debit_minutes(
  p_payer uuid,
  p_minutes numeric,
  p_reason text,
  p_session uuid default null,
  p_participant uuid default null,
  p_bucket timestamptz default null,
  p_multiplier int default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.billing_accounts;
  v_prepaid numeric;
  v_trial numeric;
  v_id bigint;
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'INVALID_MINUTES';
  end if;

  select * into v_account from public.billing_accounts where user_id = p_payer for update;
  if not found then
    raise exception 'NO_BILLING_ACCOUNT';
  end if;

  if v_account.billing_type = 'postpaid' then
    insert into public.usage_ledger (
      payer_id, session_id, participant_id, minute_bucket, lang_multiplier,
      billed_minutes, billing_type, kind, reason
    )
    values (p_payer, p_session, p_participant, p_bucket, p_multiplier, p_minutes, 'postpaid', 'accrual', p_reason)
    on conflict on constraint usage_ledger_idempotency_key do nothing
    returning id into v_id;

    if v_id is null then
      return 0;
    end if;
    update public.billing_accounts
    set postpaid_minutes_accrued = postpaid_minutes_accrued + p_minutes
    where user_id = p_payer;
    return p_minutes;
  end if;

  v_prepaid := least(v_account.prepaid_minutes_remaining, p_minutes);
  v_trial := least(v_account.trial_minutes_remaining, p_minutes - v_prepaid);

  insert into public.usage_ledger (
    payer_id, session_id, participant_id, minute_bucket, lang_multiplier,
    billed_minutes, trial_minutes, prepaid_minutes, billing_type, kind, reason
  )
  values (
    p_payer, p_session, p_participant, p_bucket, p_multiplier,
    v_prepaid + v_trial, v_trial, v_prepaid, v_account.billing_type, 'debit', p_reason
  )
  on conflict on constraint usage_ledger_idempotency_key do nothing
  returning id into v_id;

  if v_id is null then
    return 0;
  end if;

  update public.billing_accounts
  set prepaid_minutes_remaining = prepaid_minutes_remaining - v_prepaid,
      trial_minutes_remaining = trial_minutes_remaining - v_trial
  where user_id = p_payer;

  return v_prepaid + v_trial;
end
$$;

-- Starts a prepaid subscription period: the prepaid bucket is RESET to the plan's minutes
-- (unused minutes do not roll over; trial minutes are untouched). Idempotent via payment_events.
-- Returns false for a duplicate event.
create function public.credit_minutes(
  p_user uuid,
  p_minutes int,
  p_event_id text,
  p_event_name text,
  p_variant_id bigint,
  p_plan text,
  p_payload jsonb default '{}'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_account public.billing_accounts;
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'INVALID_MINUTES';
  end if;

  select * into v_account from public.billing_accounts where user_id = p_user for update;
  if not found then
    raise exception 'NO_BILLING_ACCOUNT';
  end if;

  insert into public.payment_events (id, user_id, variant_id, event_name, minutes, payload)
  values (p_event_id, p_user, p_variant_id, p_event_name, p_minutes, coalesce(p_payload, '{}'))
  on conflict (id) do nothing
  returning id into v_event;

  if v_event is null then
    return false;
  end if;

  if v_account.prepaid_minutes_remaining > 0 then
    insert into public.usage_ledger (payer_id, billed_minutes, prepaid_minutes, billing_type, kind, reason)
    values (
      p_user, v_account.prepaid_minutes_remaining, v_account.prepaid_minutes_remaining,
      v_account.billing_type, 'expire', 'subscription_period_reset'
    );
  end if;

  update public.billing_accounts
  set prepaid_minutes_remaining = p_minutes,
      billing_type = 'prepaid',
      plan = p_plan,
      ls_variant_id = p_variant_id,
      status = 'active'
  where user_id = p_user;

  insert into public.usage_ledger (payer_id, billed_minutes, prepaid_minutes, billing_type, kind, reason)
  values (p_user, p_minutes, p_minutes, 'prepaid', 'credit', p_event_name);

  return true;
end
$$;

-- Links (or updates) the Lemon Squeezy subscription on a billing account.
create function public.link_subscription(
  p_user uuid,
  p_subscription_id text,
  p_customer_id text,
  p_variant_id bigint,
  p_status text,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.billing_accounts
  set ls_subscription_id = p_subscription_id,
      ls_customer_id = p_customer_id,
      ls_variant_id = p_variant_id,
      status = p_status,
      period_end = p_period_end
  where user_id = p_user;

  if not found then
    raise exception 'NO_BILLING_ACCOUNT';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Backfill users that existed before this schema
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, avatar_url)
select
  u.id,
  left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), 120),
  left(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), 2048)
from auth.users u
on conflict (id) do nothing;

insert into public.billing_accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;

select private.grant_trial(id, email) from auth.users where email_confirmed_at is not null;
