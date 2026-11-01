-- Phase 3B (12): owner-only reporting views in their own schema. Never in schema public (which
-- the API exposes). anon and authenticated have no access to the schema or its views; the
-- service role (SQL editor / server) reads them.

create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;
grant usage on schema admin to service_role;
alter default privileges in schema admin revoke all on tables from anon, authenticated;

-- Per session: what payers were charged against what the TransVoice API processed.
--   api_speech_seconds = sum over api_usage_events = speech seconds x target languages.
--   billed_per_api_second > 1 means users paid for more than the API processed (idle connected
--   time is billed, speech is not), < 1 means a loss on that session.
create view admin.session_costs as
with billed as (
  select session_id,
         sum(billed_minutes) as billed_minutes,
         sum(shortfall_minutes) as shortfall_minutes,
         sum(billable_seconds) as billable_seconds,
         count(distinct payer_id) as payers,
         count(*) as ledger_rows
  from public.usage_ledger
  where session_id is not null and kind in ('debit', 'accrual')
  group by session_id
),
api as (
  select session_id,
         sum(speech_seconds) as api_speech_seconds,
         count(*) as api_calls,
         count(distinct target_lang) as target_languages
  from public.api_usage_events
  where session_id is not null
  group by session_id
)
select cs.id as session_id,
       cs.status,
       cs.started_at,
       cs.ended_at,
       coalesce(b.payers, 0) as payers,
       coalesce(b.billed_minutes, 0) as billed_minutes,
       coalesce(b.shortfall_minutes, 0) as shortfall_minutes,
       coalesce(b.billable_seconds, 0) as billable_seconds,
       coalesce(a.api_speech_seconds, 0) as api_speech_seconds,
       coalesce(a.api_calls, 0) as api_calls,
       coalesce(a.target_languages, 0) as target_languages,
       round(coalesce(b.billed_minutes, 0) * 60 / nullif(a.api_speech_seconds, 0), 3)
         as billed_per_api_second
from public.call_sessions cs
left join billed b on b.session_id = cs.id
left join api a on a.session_id = cs.id
where b.session_id is not null or a.session_id is not null;

-- Per payer: does the ledger explain the balance? expected = credits and refunds - debits -
-- expired subscription minutes (free_trial and credit_minutes write the credits). Anything but
-- difference = 0 (and accrual_difference = 0 for postpaid) needs a look.
create view admin.billing_reconciliation as
with ledger as (
  select payer_id,
         sum(billed_minutes) filter (where kind in ('credit', 'refund')) as credits,
         sum(billed_minutes) filter (where kind = 'debit') as debits,
         sum(billed_minutes) filter (where kind = 'expire') as expired,
         sum(billed_minutes) filter (where kind = 'accrual') as accruals,
         sum(shortfall_minutes) as shortfall_minutes,
         max(created_at) as last_ledger_at
  from public.usage_ledger
  group by payer_id
)
select ba.user_id as payer_id,
       ba.billing_type,
       ba.trial_minutes_remaining + ba.prepaid_minutes_remaining as balance,
       coalesce(l.credits, 0) as ledger_credits,
       coalesce(l.debits, 0) as ledger_debits,
       coalesce(l.expired, 0) as ledger_expired,
       coalesce(l.credits, 0) - coalesce(l.debits, 0) - coalesce(l.expired, 0) as expected_balance,
       ba.trial_minutes_remaining + ba.prepaid_minutes_remaining
         - (coalesce(l.credits, 0) - coalesce(l.debits, 0) - coalesce(l.expired, 0)) as difference,
       ba.postpaid_minutes_accrued,
       coalesce(l.accruals, 0) as ledger_accruals,
       ba.postpaid_minutes_accrued - coalesce(l.accruals, 0) as accrual_difference,
       coalesce(l.shortfall_minutes, 0) as shortfall_minutes,
       l.last_ledger_at
from public.billing_accounts ba
left join ledger l on l.payer_id = ba.user_id;

revoke all on all tables in schema admin from public, anon, authenticated;
grant select on admin.session_costs, admin.billing_reconciliation to service_role;
