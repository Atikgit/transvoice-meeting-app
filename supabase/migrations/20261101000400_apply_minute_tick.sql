-- Phase 3B (8): the minute meter. Service role / pg_cron only.
--
-- Walks the closed 1-minute buckets from private.billing_cursor up to p_until (default: now - 70 s,
-- so a bucket is processed after the last heartbeat and webhook of its final seconds have had
-- time to arrive), at most 120 buckets per run, and writes one usage_ledger row per
-- (session, billed entity, bucket). Safe to run twice or concurrently: an advisory lock admits
-- one run at a time, and the ledger's unique key makes a repeated bucket a no-op. Downtime only
-- delays billing; the cursor catches up on the following runs.
--
-- Billing basis (private.app_settings.billing_basis, set from the app's BILLING_BASIS):
--   per_payer (default)  every DISTINCT payer is charged once per bucket for all their people
--                        together (sponsor + sponsored guests = one charge). Billable seconds =
--                        union of the time their people were connected while anyone else was
--                        connected too. ledger.participant_id = the payer.
--   per_participant      each person is charged to their payer for their own overlap seconds.
--                        ledger.participant_id = the person.
-- Multiplier L (lang_multiplier_enabled; otherwise 1):
--   per_payer            the largest number of distinct target languages any single speaker in the
--                        room needs in that bucket (listeners' languages that differ from that
--                        speaker's spoken language), at least 1. Same L for every payer of the room.
--   per_participant      the same count for that participant only.
-- "Same language" follows lib/transvoice/languages.ts languageKey (primary subtag; zh traditional
-- vs simplified), so en-US and en-GB listeners are one language.
-- billed = billable_seconds / 60 x L, rounded to 4 decimals.
-- Debit order: subscription (prepaid) minutes first, then trial minutes, never below zero; what
-- could not be covered is recorded as shortfall_minutes. Postpaid payers accrue instead.

create function private.multirange_seconds(p_ranges tstzmultirange)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0) from unnest(p_ranges) as r
$$;

create function private.language_key(p_locale text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(split_part(replace(p_locale, '_', '-'), '-', 1)) = 'zh' then
      case
        when replace(lower(p_locale), '_', '-') ~ '(^|-)hant(-|$)'
          or replace(lower(p_locale), '_', '-') ~ '(^|-)(tw|hk|mo)(-|$)' then 'zh-hant'
        else 'zh'
      end
    else lower(split_part(replace(p_locale, '_', '-'), '-', 1))
  end
$$;

create function public.apply_minute_tick(
  p_until timestamptz default now() - interval '70 seconds'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis text := coalesce(
    (select value #>> '{}' from private.app_settings where key = 'billing_basis'), 'per_payer');
  v_multiplier boolean := coalesce(
    (select (value #>> '{}')::boolean from private.app_settings where key = 'lang_multiplier_enabled'), true);
  v_from timestamptz;
  v_to timestamptz;
  r record;
  v_account public.billing_accounts;
  v_prepaid numeric;
  v_trial numeric;
  v_shortfall numeric;
  v_inserted bigint;
  v_rows int := 0;
  v_existing int := 0;
  v_debited numeric := 0;
  v_accrued numeric := 0;
  v_short_total numeric := 0;
  v_payers uuid[] := '{}';
  v_no_account int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('transvoice.apply_minute_tick')) then
    return jsonb_build_object('skipped', true, 'reason', 'locked');
  end if;

  select last_bucket_end into v_from from private.billing_cursor for update;
  if not found then
    insert into private.billing_cursor (last_bucket_end) values (date_trunc('minute', p_until));
    return jsonb_build_object('skipped', false, 'buckets', 0, 'rows', 0, 'initialised', true);
  end if;
  v_from := date_trunc('minute', v_from);
  v_to := least(date_trunc('minute', p_until), v_from + interval '120 minutes');
  if v_to <= v_from then
    return jsonb_build_object('skipped', false, 'buckets', 0, 'rows', 0,
                              'basis', v_basis, 'cursor', v_from);
  end if;

  for r in
    with buckets as (
      select g as b_start, g + interval '1 minute' as b_end
      from generate_series(v_from, v_to - interval '1 minute', interval '1 minute') as g
    ),
    seg as (
      select bk.b_start, bk.b_end, s.session_id, s.user_id, s.payer_id, s.connected_at,
             private.segment_effective_end(
               s.connected_at, s.disconnected_at, s.last_heartbeat_at, bk.b_end) as eff_end
      from buckets bk
      join public.participant_segments s
        on s.connected_at < bk.b_end
       and (s.disconnected_at is null or s.disconnected_at > bk.b_start)
    ),
    clipped as (
      select b_start, session_id, user_id, payer_id,
             tstzrange(greatest(connected_at, b_start), least(eff_end, b_end)) as rng
      from seg
      where least(eff_end, b_end) > greatest(connected_at, b_start)
    ),
    presence as (
      select b_start, session_id, user_id, payer_id, range_agg(rng) as mr
      from clipped
      group by b_start, session_id, user_id, payer_id
    ),
    -- Each person's connected time that overlaps with anybody else in the same session.
    ov as (
      select p.b_start, p.session_id, p.user_id, p.payer_id,
             p.mr * coalesce(o.m, '{}'::tstzmultirange) as mr
      from presence p
      left join lateral (
        select range_agg(q.mr) as m
        from presence q
        where q.b_start = p.b_start and q.session_id = p.session_id and q.user_id <> p.user_id
      ) o on true
    ),
    people as (
      select ov.*, private.multirange_seconds(ov.mr) as secs, mp.spoken_lang, mp.listen_lang
      from ov
      left join public.meeting_participants mp
        on mp.session_id = ov.session_id and mp.user_id = ov.user_id
      where private.multirange_seconds(ov.mr) > 0
    ),
    -- L per speaker: distinct languages the other people present listen in, minus the speaker's own.
    with_l as (
      select pe.*,
             (select count(distinct private.language_key(q.listen_lang))
              from people q
              where q.b_start = pe.b_start and q.session_id = pe.session_id
                and q.user_id <> pe.user_id
                and q.listen_lang is not null and pe.spoken_lang is not null
                and private.language_key(q.listen_lang) <> private.language_key(pe.spoken_lang)
             ) as langs
      from people pe
    ),
    rated as (
      select w.*, max(w.langs) over (partition by w.b_start, w.session_id) as room_langs
      from with_l w
    ),
    final as (
      select payer_id, user_id as billed_id, b_start, session_id, secs,
             case when v_multiplier then greatest(1, langs) else 1 end as mult
      from rated
      where v_basis = 'per_participant'
      union all
      select payer_id, payer_id, b_start, session_id,
             private.multirange_seconds(range_agg(mr)),
             case when v_multiplier then greatest(1, max(room_langs)) else 1 end
      from rated
      where v_basis = 'per_payer'
      group by payer_id, b_start, session_id
    )
    select payer_id, billed_id, b_start, session_id, secs, mult::int as mult,
           round(secs / 60.0 * mult, 4) as minutes
    from final
    where secs > 0
    order by payer_id, b_start, session_id, billed_id
  loop
    select * into v_account from public.billing_accounts where user_id = r.payer_id for update;
    if not found then
      v_no_account := v_no_account + 1;
      continue;
    end if;

    if v_account.billing_type = 'postpaid' then
      insert into public.usage_ledger (
        payer_id, session_id, participant_id, minute_bucket, lang_multiplier, billed_minutes,
        billing_type, kind, reason, billable_seconds, shortfall_minutes, billing_basis
      )
      values (
        r.payer_id, r.session_id, r.billed_id, r.b_start, r.mult, r.minutes,
        'postpaid', 'accrual', 'minute_tick', r.secs, 0, v_basis
      )
      on conflict on constraint usage_ledger_idempotency_key do nothing
      returning id into v_inserted;
      if v_inserted is null then
        v_existing := v_existing + 1;
        continue;
      end if;
      update public.billing_accounts
      set postpaid_minutes_accrued = postpaid_minutes_accrued + r.minutes
      where user_id = r.payer_id;
      v_accrued := v_accrued + r.minutes;
    else
      v_prepaid := least(v_account.prepaid_minutes_remaining, r.minutes);
      v_trial := least(v_account.trial_minutes_remaining, r.minutes - v_prepaid);
      v_shortfall := r.minutes - v_prepaid - v_trial;
      insert into public.usage_ledger (
        payer_id, session_id, participant_id, minute_bucket, lang_multiplier, billed_minutes,
        trial_minutes, prepaid_minutes, billing_type, kind, reason, billable_seconds,
        shortfall_minutes, billing_basis
      )
      values (
        r.payer_id, r.session_id, r.billed_id, r.b_start, r.mult, v_prepaid + v_trial,
        v_trial, v_prepaid, v_account.billing_type, 'debit', 'minute_tick', r.secs,
        v_shortfall, v_basis
      )
      on conflict on constraint usage_ledger_idempotency_key do nothing
      returning id into v_inserted;
      if v_inserted is null then
        v_existing := v_existing + 1;
        continue;
      end if;
      update public.billing_accounts
      set prepaid_minutes_remaining = prepaid_minutes_remaining - v_prepaid,
          trial_minutes_remaining = trial_minutes_remaining - v_trial
      where user_id = r.payer_id;
      v_debited := v_debited + v_prepaid + v_trial;
      v_short_total := v_short_total + v_shortfall;
    end if;

    v_rows := v_rows + 1;
    if not (r.payer_id = any (v_payers)) then
      v_payers := v_payers || r.payer_id;
    end if;
  end loop;

  update private.billing_cursor set last_bucket_end = v_to, updated_at = now();

  return jsonb_build_object(
    'skipped', false,
    'basis', v_basis,
    'from', v_from,
    'to', v_to,
    'buckets', extract(epoch from v_to - v_from)::int / 60,
    'rows', v_rows,
    'already_billed', v_existing,
    'minutes_debited', v_debited,
    'minutes_accrued', v_accrued,
    'shortfall_minutes', v_short_total,
    'payers_touched', cardinality(v_payers),
    'payers_depleted', (
      select count(*) from unnest(v_payers) as p where not public.has_available_minutes(p)),
    'payers_without_account', v_no_account
  );
end
$$;

revoke execute on function public.apply_minute_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_minute_tick(timestamptz) to service_role;
