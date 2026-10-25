PHASE 3 — Fast translation + minute metering. Work on a new branch phase-3 from main.

STEP 0 (do first)
- git checkout main && git pull. Confirm branch fix-room-session is merged (one open session per meeting; dashboard "Invite Partner" reuses the host's current meeting). If it is NOT merged, stop and tell me.
- Save this entire message verbatim as docs/PHASE-3.md and commit ("docs: phase 3 spec"). Append the DECISIONS section below to §13 of docs/PROMPT.md. In later sessions work from docs/PHASE-3.md.
- Work in three checkpoints: 3A, 3B, 3C. STOP after each one and report: summary, commit list, tests run AND tests you could not run, env vars, migrations, deploy steps, manual test steps. One commit per item, with my configured git identity. After each checkpoint try `git push -u origin phase-3`; if it fails, say so and do not retry.

CONTEXT (verified in production: meet.transvoice.ai, Hetzner, Docker, Nginx -> 172.17.0.1:3003; never change that port binding)
- Two devices join the same room; video and ORIGINAL voice work.
- Live translation (checkpoint 2B) has NOT been confirmed working in production.
- No minutes are deducted yet. TRANSLATION_BETA_ALLOWLIST limits translation to my accounts. Keep it until I change it.
- Business rules are in docs/PROMPT.md §1 and §6. Summary of the final billing rules:
  * Billing runs only while >= 2 users are connected at the same time. Ringing, missed, declined, waiting alone and disconnected time are never billed. No silence detection or discount.
  * Each participant has one payer, fixed at join: the sponsor if they joined through a valid invitation, otherwise themselves.
  * Language multiplier ON (LANG_MULTIPLIER_ENABLED=true): L = number of distinct listener languages among the OTHER connected participants that differ from this participant's spoken language, minimum 1.
  * Minutes: trial_minutes_remaining (15 free, never expire) and prepaid_minutes_remaining (subscription minutes, reset at renewal). Postpaid accrues in postpaid_minutes_accrued.
  * Chat is always free.

DECISIONS (add to §13)
1. A sponsored connection's expires_at only controls starting/redialing a call. A call already in progress is never cut because the window expires.
2. Debit order for free/prepaid payers: subscription minutes first, then trial minutes. Never go negative.
3. A paid guest whose sponsor ran out of minutes can switch to paying for themselves for the rest of the session.
4. Usage events (speech seconds) are recorded by our own /api/translate route. Do not build an API-server push endpoint now.
5. Latency targets, measured speech-end -> translated audio start: p50 <= 1.8 s, p95 <= 3 s. Report measured values; never claim numbers you did not measure.
6. Translation stays behind TRANSLATION_BETA_ALLOWLIST until I set it to "*".

============================================================
CHECKPOINT 3A — Make translation work, then make it fast
============================================================
1. Debug overlay: room URL ?debug=1, visible only to allowlisted users or in dev. Show: VAD model loaded/listening/speech-detected; mic muted?; connected remote participants count; last utterance (duration, size); last /api/translate status and ms; last caption received (language); last audio URL fetch status; playback queue length; AudioContext state; own and listeners' spoken/listen languages.
2. Production diagnosis: translation was not confirmed. Review the whole path and fix every root cause you find. Check at least:
   a. VAD gating (session live AND >= 2 participants connected AND mic unmuted): the participant count must come from LiveKit remote participants, not from a stale source.
   b. Every joined user (host and guest) has a meeting_participants row for the open session with spoken_lang, listen_lang AND payer_id (resolve_payer at join/token time). Fan-out and billing both depend on this.
   c. CSP and asset loading for /vad (wasm, onnx), Nginx client_max_body_size (>= 2m), container -> TRANSVOICE_API_URL connectivity.
   d. Caption/audio data messages reach only the correct listeners (destinationIdentities use user ids).
   Explain what you found, in plain words.
3. Latency. First measure and report the baseline per-stage breakdown (VAD end, upload, API call per language, delivery, fetch, playback start). Then optimize, one measurable change per commit:
   a. Keep-alive HTTP agent (undici) to the TransVoice API, plus a warm-up ping at boot and every 30 s while any session is live.
   b. VAD end-of-speech default 400 ms (configurable 300-700 ms by env), min speech 300 ms.
   c. Client prefetch: when a caption with an audio URL arrives, fetch and decodeAudioData immediately so playback starts the moment it is that clip's turn.
   d. Server: send the caption as soon as translated text is known for a language (do not wait for TTS or for other languages).
   e. Optional compressed audio: if the API response includes an audio format field (I may add output_format "mp3"/"opus" to my API; env TRANSVOICE_OUTPUT_FORMAT, default wav = current behaviour) and the clip is <= 12 KiB, send it inline in the LiveKit data packet (topic tvx.audio.inline) and skip the HTTP fetch; otherwise use the URL path. Feature-detect; never break the WAV path.
   Do NOT add chunk-streaming or other large redesigns.
4. `pnpm latency:report`: reads JSON log lines from stdin and prints p50/p95 per stage and per language pair. Document: docker logs --since 1h transvoice_meeting_app 2>&1 | pnpm latency:report.
5. Tests: unit tests for any new logic; keep all existing tests green.
STOP after 3A.

============================================================
CHECKPOINT 3B — Minute meter (the money part: correctness over speed)
============================================================
6. Migration:
   - participant_segments: add last_heartbeat_at; unique index so a user has at most one open segment per session.
   - billing_cursor (single row: last processed bucket).
   - usage_ledger: verify it matches docs/PROMPT.md §5 (payer_id, session_id, participant_id, minute_bucket, lang_multiplier, billed_minutes, billing_type, kind, unique(session_id, participant_id, minute_bucket, kind)); add billable_seconds, trial_debited, subscription_debited, shortfall_minutes for audit.
   - RLS: clients can read only their own ledger rows (as payer); nobody can write ledger, segments or billing_accounts from the client.
7. Heartbeat: POST /api/heartbeat every 20 s from the room page updates the user's open segment last_heartbeat_at (verify whether it already exists from Phase 2; if so, reuse). Effective segment end = coalesce(disconnected_at, least(bucket_end, last_heartbeat_at + 45 s)). A tab that crashed therefore stops being billed 45 s after its last heartbeat.
8. SQL function apply_minute_tick(p_until timestamptz default now() - interval '70 seconds'), service role only:
   - take an advisory lock (skip if another run holds it); process closed 1-minute buckets from billing_cursor to p_until, max 120 buckets per run; update the cursor; so downtime or restarts never lose billing.
   - per bucket and participant: billable_seconds = seconds this participant was connected inside the bucket AND at least one other participant was also connected (interval overlap, e.g. tstzmultirange). Billable minutes = billable_seconds / 60 x L (L as defined above, using meeting_participants languages).
   - lock the payer's billing_accounts row, then: free/prepaid -> debit prepaid_minutes_remaining first, then trial_minutes_remaining, never below zero, record shortfall_minutes if the balance was not enough; postpaid -> add to postpaid_minutes_accrued, flag depleted if postpaid_credit_limit_minutes is exceeded.
   - one ledger row per (session, participant, bucket, kind); idempotent; skip rows with 0 billable seconds.
   - return a jsonb summary (buckets, rows, minutes debited, payers touched).
9. Scheduling: primary = pg_cron every minute calling apply_minute_tick (enable the extension in the migration if allowed; document the Supabase dashboard step and how to verify via cron.job and cron.job_run_details). Fallback = in-app timer every 60 s in the existing sweeper process, plus POST /api/internal/meter-tick protected by CRON_SECRET. Running both is safe because of the lock and idempotency. Log one JSON line per run with counts only (no personal data).
10. Sweeper fix: close stale segments at last_heartbeat_at (not now()); never leave a closed session with open segments. Add MAX_SESSION_HOURS (default 4): longer sessions are ended. Add TRANSLATION_ENABLED env kill switch (false = translation off everywhere, calls still work).
11. /api/translate records api_usage_events (session, speaker, target_lang, speech_seconds from the WAV length, request_id unique) after each successful API call.
12. Admin views in schema admin (create it, revoke all from anon and authenticated): admin.session_costs (per session: billed minutes vs speech seconds x languages) and admin.billing_reconciliation (ledger debits vs balance changes). Never put these in schema public.
13. Tests (DB tests on the in-memory Postgres; every case needs explicit numbers):
   a. sponsored guest connected 3 min with host: sponsor debited, guest's balance unchanged.
   b. a person invited by the guest is billed to the guest, not the original host.
   c. lone participant, ringing, declined and missed calls bill 0.
   d. a disconnect gap is not billed; a participant who joins mid-minute is billed the partial fraction only for the overlap.
   e. two foreign listener languages -> x2; one -> x1; same language for all -> x1.
   f. running the tick twice, and two ticks concurrently, produce one set of rows.
   g. subscription minutes are debited before trial minutes; balance never negative; shortfall recorded.
   h. postpaid accrues and respects the credit limit.
   i. a crashed tab (no heartbeat) stops billing 45 s after its last heartbeat.
   j. downtime catch-up: cursor 10 minutes behind -> all 10 buckets processed once.
   k. a session that ended mid-bucket still bills its final partial bucket on the next tick.
STOP after 3B.

============================================================
CHECKPOINT 3C — Gating, UX, billing page
============================================================
14. Translation gate in /api/translate: allowed only if TRANSLATION_ENABLED AND the speaker's payer has available minutes AND (allowlist is "*" or the session host is in TRANSLATION_BETA_ALLOWLIST). If the payer has no minutes return 402 {code:"payer_no_minutes", payerIsMe}. Cache the check for 5 s. The call and chat continue.
15. GET /api/billing/balance: {trialMinutes, subscriptionMinutes, plan, billingType, low}. The room polls it every 20 s while live, only for users who are a payer. Toasts at <= 5 and <= 1 minute. Guests never see numbers or balance prompts; they see only "Host's minutes have run out" with Message host / Subscribe, or Pay for myself (decision 3).
16. In-room minute meter for the payer ("12 min left"); host Start and guest-initiated Call must check has_available_minutes for the payer and show a clear message.
17. RPC switch_payer_to_self(session): only for a participant with their own available minutes; updates their meeting_participants.payer_id from now on; ledger rows already written stay unchanged.
18. /dashboard/billing: plan name, trial + subscription minutes, postpaid accrued (if any), usage per session, and "minutes used by people I invited" per sponsored guest (names only for my own guests). Lemon Squeezy portal link as a placeholder (Phase 5).
19. docs/deploy-phase-3.md: migrations, pg_cron enable/verify, env vars, and a two-account smoke test: 3-minute call, then SQL to verify ledger rows, payer, balances; a lone participant bills nothing; kill the network on one device for 70 s; deplete a test account's minutes via SQL and check the 402 behaviour and the "Pay for myself" flow.
OUT OF SCOPE: Lemon Squeezy usage-record sync, payments UI, Azure Marketplace (removed), changing the nginx/compose port binding.

RULES: no real TransVoice API or Lemon Squeezy calls in tests (msw); keep host-agnostic (no Vercel APIs); typecheck, lint, unit tests must pass at every checkpoint; run Playwright where credentials exist and say clearly what you could not run; never log audio, text or emails.
