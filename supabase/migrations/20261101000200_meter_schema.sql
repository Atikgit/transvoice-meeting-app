-- Phase 3B (6): schema for the minute meter. Nothing is billed here; apply_minute_tick (next
-- migration) reads these tables.
--
-- Already present from earlier migrations, so only verified (tests/db/meter-schema.test.ts):
--   * participant_segments.last_heartbeat_at and the unique "one open segment per user and
--     session" index (participant_segments_one_open);
--   * usage_ledger with payer_id, session_id, participant_id, minute_bucket, lang_multiplier,
--     billed_minutes, billing_type, kind and unique (session_id, participant_id, minute_bucket,
--     kind); trial_minutes / prepaid_minutes are the portions taken from each bucket;
--   * RLS: a payer reads their own ledger rows; no client privilege to write them.

-- Audit columns for the tick.
alter table public.usage_ledger
  add column billable_seconds numeric(10, 3) check (billable_seconds >= 0),
  add column shortfall_minutes numeric(12, 4) not null default 0 check (shortfall_minutes >= 0),
  add column billing_basis text check (billing_basis in ('per_payer', 'per_participant')),
  -- Names used by the spec: the same numbers as trial_minutes / prepaid_minutes.
  add column trial_debited numeric(12, 4) generated always as (trial_minutes) stored,
  add column subscription_debited numeric(12, 4) generated always as (prepaid_minutes) stored;

comment on column public.usage_ledger.participant_id is
  'per_participant basis: the person billed. per_payer basis: the payer (one row per payer and bucket).';
comment on column public.usage_ledger.shortfall_minutes is
  'Minutes that could not be debited because the balance ran out (billed_minutes is what was covered).';

-- The tick reads segments by time.
create index participant_segments_connected_idx on public.participant_segments (connected_at);

-- Last fully processed minute boundary. One row. Starts at the migration time: calls that ended
-- before the meter existed are not billed retroactively.
create table private.billing_cursor (
  id boolean primary key default true check (id),
  last_bucket_end timestamptz not null,
  updated_at timestamptz not null default now()
);
insert into private.billing_cursor (last_bucket_end) values (date_trunc('minute', now()));
alter table private.billing_cursor enable row level security;
revoke all on private.billing_cursor from anon, authenticated;

-- Billing settings every scheduler sees. The app copies BILLING_BASIS and
-- LANG_MULTIPLIER_ENABLED here (configure_billing); pg_cron has no access to the app's env.
insert into private.app_settings (key, value) values
  ('billing_basis', '"per_payer"'),
  ('lang_multiplier_enabled', 'true'),
  ('segment_heartbeat_grace_seconds', '45');

create function public.configure_billing(p_basis text, p_multiplier boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_basis not in ('per_payer', 'per_participant') then
    raise exception 'INVALID_BILLING_BASIS';
  end if;
  insert into private.app_settings (key, value) values
    ('billing_basis', to_jsonb(p_basis)),
    ('lang_multiplier_enabled', to_jsonb(coalesce(p_multiplier, true)))
  on conflict (key) do update set value = excluded.value;
end
$$;

revoke execute on function public.configure_billing(text, boolean) from public, anon, authenticated;
grant execute on function public.configure_billing(text, boolean) to service_role;
