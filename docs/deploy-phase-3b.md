# Deploying Phase 3B - the minute meter

Until this phase nothing deducted minutes: a host's balance stayed at 15 after real calls (65
connection segments and 0 ledger debits in production). 3B adds the meter. Spec:
[PHASE-3.md](PHASE-3.md) checkpoint 3B, with the changes listed below.

## What bills what

- A 1-minute bucket is billed only if at least 2 people were connected at the same time.
  Waiting alone, ringing, declined, missed and disconnected time bills nothing. Chat is free.
- `BILLING_BASIS=per_payer` (default): every **distinct payer** is charged once per bucket for all
  their people together (a sponsor plus the guests they invited = one charge). Billable fraction =
  seconds that payer's people were connected while anyone else was connected too, divided by 60.
  `per_participant` keeps the original rule (each person is charged to their payer).
- Multiplier `L` (`LANG_MULTIPLIER_ENABLED=true`): the largest number of distinct target
  languages any single speaker in the room needs in that bucket, at least 1. A 1:1 bn <-> en call
  has `L = 1`. "Same language" ignores the region (en-US = en-GB); Chinese traditional and
  simplified differ.
- Debit order: subscription minutes first, then trial minutes, never below zero (the missing part
  is recorded as `shortfall_minutes`). Postpaid payers accrue in `postpaid_minutes_accrued`.
- A tab that stops sending its heartbeat stops being billed 45 s after the last one.
- Calls that ended **before the first tick are not billed**: `private.billing_cursor` starts at the
  time the migration ran. To bill an earlier period on purpose, see "Back-billing" below.

## 1. Migrations (in this order, `pnpm dlx supabase db push`)

| File                               | What it does                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `20261101000200_meter_schema`      | ledger audit columns, `private.billing_cursor`, billing settings, `configure_billing()`                          |
| `20261101000300_heartbeat`         | `record_heartbeat()`, 45 s effective segment end, a join webhook no longer revives a silent segment              |
| `20261101000400_apply_minute_tick` | `apply_minute_tick(p_until)`                                                                                     |
| `20261101000500_meter_cron`        | schedules the tick with pg_cron when the extension is available, prints a notice otherwise                       |
| `20261101000600_sweeper_heartbeat` | segments are closed at the last heartbeat; a session leaving ready/live closes its segments; stale-segment sweep |
| `20261101000700_admin_views`       | schema `admin`: `session_costs`, `billing_reconciliation` (service role only)                                    |

`20261101000100_trial_status` (lower-latency branch) comes first if it is not applied yet.

## 2. Enable pg_cron (Supabase) - do this BEFORE the migrations

The migration schedules the job only if the extension exists; otherwise it prints a notice and
the app's own timer still bills (see "Two schedulers").

1. Supabase dashboard -> **Integrations -> Cron** -> _Enable_ (or **Database -> Extensions** ->
   search `pg_cron` -> enable).
2. Then run the migrations. If you enabled it afterwards, run the migration's statements once in
   the SQL editor:

```sql
select cron.schedule('transvoice-meter-tick', '* * * * *', 'select public.apply_minute_tick()');
select cron.schedule('transvoice-cron-prune', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
```

### Verify it runs

```sql
-- the jobs exist and are active
select jobid, jobname, schedule, command, active from cron.job;

-- the last runs: status 'succeeded' every minute, return_message 'SELECT 1'
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'transvoice-meter-tick')
order by start_time desc limit 10;

-- the cursor moves forward (about one minute behind now minus 70 s)
select last_bucket_end, updated_at, now() - last_bucket_end as behind from private.billing_cursor;
```

`status = 'failed'` shows the SQL error in `return_message`. A cursor that stops moving while
`cron.job_run_details` is empty means the job is not scheduled.

## 3. Environment (`.env.production`)

| Variable                  | Default     | Meaning                                                                                                             |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `BILLING_BASIS`           | `per_payer` | `per_payer` or `per_participant`. Copied into the database at boot and by each in-app tick (pg_cron reads it there) |
| `LANG_MULTIPLIER_ENABLED` | `true`      | `false` = L is always 1. Copied into the database like `BILLING_BASIS`                                              |
| `METER_TICK_SEC`          | `60`        | The app's own tick (fallback to pg_cron). `0` disables it                                                           |
| `MAX_SESSION_HOURS`       | `4`         | The sweeper ends sessions open longer than this (`end_reason = max_duration`) and closes the LiveKit room           |
| `CRON_SECRET`             | unset       | 32+ characters. Needed for `POST /api/internal/meter-tick` (503 while unset)                                        |
| `TRANSLATION_ENABLED`     | `true`      | Existing kill switch: `false` turns translation off for everyone, calls and chat go on                              |

Unchanged: `TRANSLATION_BETA_ALLOWLIST`, `SWEEP_INTERVAL_SEC`, `RECONNECT_GRACE_SEC`.
Rebuild: `docker compose up -d --build` (never change the `172.17.0.1:3003` binding). Open rooms
must be reloaded once: the new client sends the heartbeat.

### Country in the latency report

`/api/latency` adds the client country from Cloudflare's `CF-IPCountry` header (no IP is stored).
It only exists when the site is proxied by Cloudflare (orange cloud) and nginx passes request
headers on (the default). Check: `docker logs --since 10m transvoice_meeting_app 2>&1 | grep '"event":"latency"' | head -3`
shows `"country":"BD"`. Then:

```sh
docker logs --since 1h transvoice_meeting_app 2>&1 | pnpm latency:report
# ... "Client country BD", "Client country DE", ... with p50 / p95 per stage
```

## 4. Two schedulers (safe on purpose)

pg_cron calls `apply_minute_tick()` every minute; the app calls it too every `METER_TICK_SEC`.
The function takes an advisory lock (the second caller returns `skipped: locked`) and every ledger
row is unique per (session, payer or person, minute), so running both can never bill twice. If one
is down the other keeps billing; if both were down, the next tick catches up (max 120 minutes per
run, so a day of downtime takes 12 runs).

Manual re-run, any time:

```sh
curl -s -X POST https://meet.transvoice.ai/api/internal/meter-tick -H "Authorization: Bearer $CRON_SECRET"
# {"skipped":false,"buckets":2,"rows":2,"minutesDebited":2,...}
```

Logs (counts only, idle minutes are silent): `docker logs transvoice_meeting_app 2>&1 | grep -E 'meter_tick|"sweep"'`.

## 5. Smoke test - a 3-minute call between two accounts

Use two real test accounts: **A** (host, 15 trial minutes) and **B** (invited by A through an
invitation link, so A is B's payer). Replace the two emails below.

1. Note both balances (query 1). A: open the meeting and press **Start**; B: open the invite link
   and join. Talk for 3 minutes with both tabs open, then End the meeting.
2. Wait about 2 minutes (a minute is billed 70 s after it closes), then run the queries.

```sql
-- 1. balances (service role / SQL editor)
select u.email, b.billing_type, b.trial_minutes_remaining as trial,
       b.prepaid_minutes_remaining as subscription, b.postpaid_minutes_accrued as accrued
from auth.users u join public.billing_accounts b on b.user_id = u.id
where u.email in ('a@example.com', 'b@example.com');

-- 2. the session and who pays for whom (payer must be A for both)
select s.id as session_id, s.status, s.started_at, s.ended_at, s.end_reason,
       pu.email as person, mp.role, py.email as payer
from public.call_sessions s
join public.meeting_participants mp on mp.session_id = s.id
join auth.users pu on pu.id = mp.user_id
join auth.users py on py.id = mp.payer_id
where s.id = (select cs.id from public.call_sessions cs
              join public.meeting_participants m on m.session_id = cs.id
              join auth.users u on u.id = m.user_id
              where u.email = 'a@example.com' order by cs.created_at desc limit 1);

-- 3. connection segments (heartbeat should be within ~20 s of the end)
select u.email, g.connected_at, g.disconnected_at, g.last_heartbeat_at
from public.participant_segments g join auth.users u on u.id = g.user_id
where g.session_id = '<session_id from query 2>' order by g.connected_at;

-- 4. ledger rows: expect ~3 rows, payer = A, billable_seconds 60 (the first/last minute can be
--    less), lang_multiplier 1 for a bn <-> en call, billed_minutes = billable_seconds / 60
select l.minute_bucket, py.email as payer, l.lang_multiplier as l, l.billable_seconds,
       l.billed_minutes, l.trial_minutes as trial_debited, l.prepaid_minutes as subscription_debited,
       l.shortfall_minutes, l.billing_basis
from public.usage_ledger l join auth.users py on py.id = l.payer_id
where l.session_id = '<session_id>' order by l.minute_bucket;

-- 5. the ledger explains the balances: difference must be 0 for both
select u.email, r.balance, r.expected_balance, r.difference
from admin.billing_reconciliation r join auth.users u on u.id = r.payer_id
where u.email in ('a@example.com', 'b@example.com');
```

Expected: A's trial balance dropped by the sum of `billed_minutes` (about 3, e.g. 15 -> 12.0xxx),
B's balance is still 15, query 5 shows `difference = 0`. B has no ledger rows as payer.

3. **Idempotency:** `select public.apply_minute_tick();` twice more - `rows: 0`, balances unchanged.
4. **A lone participant bills nothing:** A joins a new meeting alone for 3 minutes; after 2
   minutes query 4 for that session returns no rows.
5. **Network loss:** with both connected, switch B's network off (airplane mode) for 70 s, then
   back on. Query 3 shows B's segment closed at its last heartbeat + 45 s (or a new segment after
   the gap); the minutes in between are not billed to A.
6. **Out of minutes** (test accounts only!):
   `update public.billing_accounts set trial_minutes_remaining = 0.5 where user_id = (select id from auth.users where email = 'a@example.com');`
   Within a minute of the next tick A's room shows "You're out of minutes. Translation has
   stopped; the call and chat continue." with **Get minutes**; B (guest) sees "No translation:
   the host's minutes have run out" and never a number. Restore the balance afterwards (also
   by SQL; the app never grants minutes by hand).
7. **Session length cap:** nothing to do; a session open longer than `MAX_SESSION_HOURS` is ended
   by the sweeper (`end_reason = 'max_duration'`).

## 6. Back-billing (only if you want it)

The cursor starts when the migration ran. To bill an earlier period, move it back and let the
tick catch up (ledger rows are unique, so already-billed minutes are skipped):

```sql
update private.billing_cursor set last_bucket_end = timestamptz '2026-11-01 00:00:00+00';
```

Sessions from before the heartbeat existed have `last_heartbeat_at` = their join time but are
closed by webhook, so they bill correctly; open ones would bill only 45 s. Look at
`admin.session_costs` before you do this.

## 7. Roll back / switch off

```sql
select cron.unschedule('transvoice-meter-tick');   -- stop the database scheduler
```

and `METER_TICK_SEC=0` in `.env.production` (restart) stops the app's timer. No data is lost: the
cursor stays where it was and the next tick bills everything in between.

## Limits to know

- Real contention between two database sessions on the advisory lock is not covered by the
  tests (the in-memory Postgres has one connection); the idempotent outcome is.
- `api_usage_events` is written for WAV uploads only (Opus uploads carry no duration).
- A heartbeat that fails for longer than 45 s (our outage) is treated as a disconnect and not
  billed - in the user's favour.
