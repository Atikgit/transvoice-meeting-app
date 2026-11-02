# Phase 3B deploy report (2026-11-02)

## Status: deployed, with one open problem (app-side meter tick fails)

| Step | Result |
|------|--------|
| 1. Git | On `main`, already up to date, tree clean. Pending migrations: 20261101000100 to 20261101000700 (7). |
| 2. DB access | Linked supabase project (`supabase/.temp`) plus the access token already in `.env.production`. `/root/.transvoice-db-url` was not needed. `select 1` succeeded. |
| 3. Backup | `~/backup-before-3b-2026-11-02.sql` (schema, 79 KB) and `~/backup-before-3b-data-2026-11-02.sql` (data, 131 KB). Both non-empty. `db dump` is schema-only by default, so the data dump was added. |
| 4. Migrations | All 7 applied with `supabase db push`, no errors. |
| 5. pg_cron | `transvoice-meter-tick` (`* * * * *`) exists and is active. `cron.job_run_details` shows `succeeded` (2 runs at 16:28 and 16:29 UTC when checked). `private.billing_cursor.last_bucket_end` = 16:27:00 UTC (set by the migration; no calls since, so nothing to bill). |
| 6. .env.production | CRON_SECRET reduced from 4 lines to 1 (last value kept). Added `BILLING_BASIS=per_payer`, `METER_TICK_SEC=60`, `MAX_SESSION_HOURS=4`. `TRANSLATION_BETA_ALLOWLIST` is `atik1125@gmail.com,coderb1b1@gmail.com` (not `*`, left unchanged). No other duplicated keys. Backup of the old file: `~/env.production.bak-before-3b` (mode 600). |
| 7. Container | Rebuilt and recreated. `/api/health` returned `{"status":"ok"}`. |
| 8. Before balances | See below. |

## Boot log (secrets removed)

```
{"event":"mailer","configured":true,"kind":"smtp"}
{"event":"transvoice_warmup","reachable":true,"status":405,"keepAlive":null,"ms":770}
{"event":"meter_tick_failed","source":"timer","error":"UPDATE requires a WHERE clause"}
```

## Problem: `meter_tick_failed`

The app's own timer calls `apply_minute_tick()` and the database rejects it with
"UPDATE requires a WHERE clause". Most likely cause: `supabase/migrations/20261101000400_apply_minute_tick.sql:236`
(`update private.billing_cursor set last_bucket_end = v_to, updated_at = now();`, no WHERE) hitting the
safeupdate guard that applies to API roles. pg_cron ran the same function successfully, but only idle
ticks have run so far, so it is not proven that cron can bill. Not fixed: a fix needs a new migration on
production (suggested: `... where id`), which was outside this task. No test calls were made.

## "Before" balances (trial / subscription / postpaid accrued)

| Account | Type | Trial | Subscription | Accrued |
|---------|------|-------|--------------|---------|
| atik1125@gmail.com | free | 15.0000 | 0.0000 | 0.0000 |
| codera1a1@gmail.com | free | 15.0000 | 0.0000 | 0.0000 |
| coderatik@outlook.com | free | 15.0000 | 0.0000 | 0.0000 |
| coderb1b1@gmail.com | free | 10.0000 | 0.0000 | 0.0000 |

## Notes

- Migration 20261101000500 schedules `transvoice-cron-prune`, which deletes `cron.job_run_details` rows older than 7 days (pg_cron's own log, not app data). Migration 20261101000600 drops and recreates the function `public.sweep_orphans()`.
- Nothing was pushed to git. nginx and the compose port binding were not touched.

---

# Follow-up (2026-11-02, after the first two-device test)

## Hotfix: `meter_tick_failed` (deployed)

- Migration `20261102000100_fix_cursor_update_where.sql` (pushed): identical function, only `where id` added to the `private.billing_cursor` update. Backups taken first: `~/backup-before-hotfix-2026-11-02-1721.sql` (schema) and `~/backup-before-hotfix-data-2026-11-02-1721.sql` (data).
- Verified: last `meter_tick_failed` at 17:23 UTC (the push); none at 17:24, 17:25, 17:26 and none in the new container's boot log. pg_cron still `succeeded` (10 of 10 in the last 10 minutes). The cursor is now also advanced by the app timer (`updated_at` 17:25:43, not on a cron minute).

## A. Billing window (migration written and tested, NOT pushed)

- Confirmed with data: session 3fa05f80, host connected 16:47:32, guest 16:47:33, Start pressed (`started_at`) 16:47:38. The first ledger row (27 s) therefore included about 5 s before Start. Total billed 199.7 s versus 194.7 s inside the live window (a 0.08-minute over-charge). The function never read `call_sessions`.
- Fix: `20261102000200_bill_live_window_only.sql` clips every segment to `started_at .. ended_at`; a session with no `started_at` bills nothing. Nothing else changes. Existing ledger rows are untouched.
- Tests (`tests/db/meter-live-window.test.ts`, 7 tests; 5 fail without the migration): both connected 60 s before Start -> 0 minutes and no ledger rows; Start at 60 s, talk to 180 s -> 2.0 not 3.0; the production case (connect 33 s, Start 38 s, end 200 s) -> 22 + 60 + 60 + 20 = 162 s = 2.7 minutes; never started -> 0; nothing after `ended_at`; lone time after Start -> 0. Full DB suite: 207 passed.
- 19 old sessions with segments never had `started_at` (they ended in 'ready'); they are all in the past and are not re-billed.

## B. Guest -> host translation (deployed)

Evidence (docker logs of the last 60 minutes, session 3fa05f80, 45 utterances):

| Direction | translated (speech) | silence | failed / refused / timeout |
|-----------|--------------------|---------|----------------------------|
| host -> guest (bn-BD>en-US) | 14 | 2 | 0 |
| guest -> host (en-US>bn-BD) | 11 | 18 (62%) | 0 |

- Every `silence` has `apiMs: 0` and `sttMs` 650 to 1370 ms: the speech-to-text answered, and what it returned was empty, one character, or a phantom word (`you`, `thank you`, `i`, `am i`), which the pipeline drops as silence. It was not a gate, a refusal or a timeout. Silent chunks were 0.5 to 3.5 s long, so length does not explain it.
- The 11 translated guest utterances were created, sent (`clip_trace created/sent`, no failures) and played by the host: each has a host `listen` beacon (`lang bn-BD`, `delivery livekit`, 2.9 to 8.1 s of audio). No `clip_drop`, `clip_quiet` or `clip_fetch_failed` report from any browser. So nothing is wrong on the host side or in the bn-BD voice (`bn-BD-PradeepNeural` / `bn-BD-NabanitaNeural`; clips played). The one `stt: timeout` (16:50:17) was recovered by the fallback.
- Not proven: the level of the guest's uploads. The server did not log input levels before today, so peak and rms of the uploaded WAVs cannot be reported for that call. The asymmetry (host 88% translated, guest 38%) and the overlay's -50 dB reading make a quiet microphone the likely cause.
- Fix deployed: peak normalization before upload (`features/translation/audio-level.ts`): target peak 0.7, at most +20 dB, gain 1 below a -60 dBFS noise floor, never attenuating, applied frame by frame so chunked uploads are covered; `autoGainControl` stays on. Logging: the browser sends `audio_level` (`pk pre>post rms pre>post g`, dBFS) to `/api/diag`, and the `translate` line now has `inputPeak` / `inputRms` of the uploaded WAV.
- Tests: `tests/unit/audio-level.test.ts` (24 tests, e.g. quiet fixture peak 0.004 = -48 dBFS -> 0.04 = -28 dBFS; 0.07 -> 0.7; 0.9 stays 0.9; 0.0008 untouched) and an `audio_level` case in `single-capture.test.tsx`. Unit suite 835 passed.
- Not changed: TRANSVOICE_TIMEOUT_MS (only one timeout, recovered).
- Build note: the Docker build printed "Ecmascript file had an error" twice; the build succeeded and the app is healthy. I did not trace it.

## Not committed

All changes (code, tests, two migrations, this report) are uncommitted in the working tree; migration 20261102000100 is already applied to production.
