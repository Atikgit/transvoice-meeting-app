# Deploying Phase 2

Phase 2 ships in three checkpoints. This file grows with each one; 2C adds the sweeper,
graceful shutdown and the final smoke-test checklist.

## Checkpoint 2A — LiveKit media and call control

### 1. Migrations (`uvgcaedyalkzsqykdhaw`)

| File                              | What it does                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `20261024000100_call_rights`      | `ready` sessions, `call_rights`, `resolve_payer`, `open_call_session`, `admit_participant`; start/end by session id |
| `20261024000200_ringing`          | `callee_id`, `create_call`, `answer_call`, `cancel_call`, `incoming_calls`; RLS for `user:<id>` Realtime channels   |
| `20261024000300_livekit_webhooks` | `record_livekit_event` (idempotent), one open `participant_segments` row per participant                            |

```sh
pnpm dlx supabase db push
```

Check the Realtime policy exists (private channels deliver nothing without it):

```sql
select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';
-- expected: "user channel: receive own"
```

### 2. Supabase dashboard

- Realtime → Settings: private channels must be allowed (they are by default). Ringing uses the
  private channel `user:<id>`; chat uses `chat:<room>` broadcast.
- Email templates: `SUPABASE_ACCESS_TOKEN=… APP_URL=https://meet.transvoice.ai pnpm auth:templates --dry-run`,
  then without `--dry-run`.

### 3. LiveKit Cloud

- Settings → Webhooks → add `https://meet.transvoice.ai/api/livekit/webhook` (signed with the
  same API key as `LIVEKIT_API_KEY`). Events used: participant_joined, participant_left,
  room_finished.
- `.env.production` already has `NEXT_PUBLIC_LIVEKIT_URL` (wss), `LIVEKIT_URL`,
  `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. `LIVEKIT_URL` may be the wss URL; the server converts
  it to https.
- `RECONNECT_GRACE_SEC` (default 60) is used for the room departure timeout and the grace check.

### 4. Env vars

No new required variables in 2A. Optional for local development: `SUPABASE_ACCESS_TOKEN` (only
for `pnpm auth:templates`, never in `.env.production`).

For the two-browser e2e test against a non-production LiveKit server:
`E2E_LIVEKIT_URL`, `E2E_LIVEKIT_API_KEY`, `E2E_LIVEKIT_API_SECRET`.

### 5. Manual test (two devices)

1. Laptop (host): dashboard → **Start meeting** → lobby → room → **Invite Partner** (the big button
   in the empty room, or the one in the control bar) → copy link.
2. Phone (guest): open link → sign up / sign in → Accept → lobby (pick camera/mic) → Join.
   The phone shows "Waiting for host to start…".
3. Laptop (already in the room): both see each other's video; the speaking person
   gets a cyan ring; mute shows the mic-off icon on the other side.
4. Laptop: **Start** → both show "Live 00:0x". Try screen share and Devices (laptop).
5. Phone: toggle airplane mode for ~10 s → "Reconnecting…", then recovers. Leave it off for
   more than 60 s on the host side → session ends, "Call again" appears.
6. Ringing: phone (guest) → dashboard → Your connections → **Call** → laptop gets the
   incoming-call modal → Accept → both go to the lobby. Let it ring 30 s once → "did not answer".
7. Webhooks: after a call,
   ```sql
   select user_id, payer_id, connected_at, disconnected_at
   from public.participant_segments order by connected_at desc limit 10;
   ```
   The guest's `payer_id` is the host while the sponsorship is valid.

## Checkpoint 2B — Real-time translation

### 1. Migrations

| File                                   | What it does                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `20261024000400_translation`           | `translation_context()`: speaker, payer, host and listeners for one utterance |
| `20261024000500_participant_languages` | `set_participant_langs()`: change languages from inside the room              |

```sh
pnpm dlx supabase db push
```

### 2. Environment (`.env.production`)

| Variable                     | Meaning                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRANSLATION_BETA_ALLOWLIST` | Comma-separated emails of meeting **hosts** that get translation. **Unset = only the built-in default (the project owner); `*` = everyone.** Set it explicitly: `codera1a1@gmail.com`                       |
| `REDIS_URL` _(optional)_     | Cache for translated clips (60 s). Unset = in-process memory, fine for the single container. If set, use a **private Docker network** URL such as `redis://transvoice_redis:6379/2`, never a published port |

Also set from the invite-email feature (optional): `EMAIL_FROM`, `RESEND_API_KEY` or `SMTP_HOST/PORT/USER/PASS`.

### 3. Build and server

- `public/vad/` (Silero model, ONNX Runtime WASM ~14 MB, AudioWorklet) is generated from the
  pinned npm packages by `pnpm build` (`scripts/copy-vad-assets.ts`), so the Docker build needs
  no extra step. `public/vad/VERSIONS.json` in the image shows the versions.
- **Content-Security-Policy** is now sent by the app (`next.config.mjs`): `wasm-unsafe-eval`,
  LiveKit and Supabase `https`/`wss` (from the `NEXT_PUBLIC_*` build args), `blob:` for audio
  and workers. If you move LiveKit or Supabase to another host, rebuild with the new build args.
- Nginx: `/api/translate` receives WAV uploads up to 2 MB. Set `client_max_body_size 2m;`
  (the default 1 MB would reject long utterances), and keep the `X-Forwarded-*` headers.
- Logs: one JSON line per utterance, without any transcript, audio or user id:
  `docker logs transvoice_meeting_app 2>&1 | grep '"event":"translate"' | tail -5`

### 4. Manual test (laptop host speaks Bangla → phone guest hears English)

1. Settings (both): laptop **I speak** Bangla, **I want to hear** Bangla; phone **I speak**
   English, **I want to hear** English. Phone: "Speaker's original voice" = _Lower it_.
2. Laptop (host, the e-mail in the allowlist): start a meeting, invite the phone, both join.
   Tap anywhere on the phone once (unlocks audio on iOS/Android).
3. Host **Start** → status "Live". Speak a Bangla sentence, then pause ~0.5 s.
4. Phone: the caption bar shows the Bangla original + English text, then the English voice
   plays and the host's own voice dips while it does. The laptop shows its own Bangla transcript.
5. Say something in English on the phone → the laptop hears Bangla. Change the laptop's
   **Languages** menu to English mid-call → the next sentence is not translated for the phone.
6. A second guest listening in Bangla gets no captions and no audio (same language).
7. Sign in as someone not in the allowlist and host a meeting: the caption bar says
   "Live translation is in private beta." and the microphone is never analysed.
8. Latency in a development build: the cyan badge at the top left (caption / audio ms).
   In production read the `translate` log lines (`apiMs`, `captionMs`, `audioMs`, `totalMs`).

## Checkpoint 2C — Hardening: sweeper, shutdown, mobile audio, error states

### 1. Migration

| File                     | What it does                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `20261025000100_sweeper` | `stale_open_sessions()`, `sweep_orphans()` (close orphan segments, expire ringing calls). Service role only, idempotent |

```sh
pnpm dlx supabase db push
pnpm db:types   # writes lib/supabase/database.generated.ts; database.types.ts adds the aliases
```

### 2. Environment (`.env.production`)

| Variable              | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `SWEEP_INTERVAL_SEC`  | Sweeper period in seconds. Default `60`; `0` disables it. No other new variables in 2C. |
| `RECONNECT_GRACE_SEC` | Unchanged (60). The sweeper treats open sessions older than this as candidates.         |

`docker-compose.yml` now has `init: true` and `stop_grace_period: 30s`; rebuild with
`docker compose up -d --build`.

### 3. What changed

**Sweeper** (`lib/sweeper.ts`, started from `instrumentation.ts` in production): one run at
container start, then every `SWEEP_INTERVAL_SEC`. Each run (1) closes participant segments left
open on ended sessions and marks unanswered ringing calls `missed`; (2) for `ready`/`live`
sessions older than the grace period, asks LiveKit who is present and ends abandoned ones
(`reconnect_timeout` / `abandoned`), the same check as the in-memory grace timer. This recovers
sessions whose timer was lost in a restart. It logs one `{"event":"sweep",…}` line only when it
did something or failed.

**First connection** (`components/meeting/meeting-room.tsx`): the header says **Connecting…**
until LiveKit is connected. If the first connection fails, or has not completed 15 s after the
room opened (or the token request takes 15 s), the page shows **"Can't reach the meeting server"**
with **Retry** (fetches a fresh token). "Call again" is only for a connection that existed and
was lost. **Reconnecting…** is only shown after a connection dropped.

**Graceful shutdown** (`docker stop` → SIGTERM): `lib/draining.ts` sets a draining flag at once.
`POST /api/translate` then answers `503 {code:"DRAINING", retryable:true}` with `Retry-After: 2`
and the browser retries that upload once after 2 s. Requests already running finish (Next.js
closes the server and waits for them); after 10 s the process exits anyway (code 143). The
listener also drops grace timers, waits ≤ 5 s for a running sweep and closes Redis. A session
whose timer was dropped is picked up by the next container's start-up sweep.

**Mobile audio** (iOS Safari, Android Chrome):

- The lobby's Join/Continue button and the room's Start button resume the shared `AudioContext`
  inside the click, and Start also calls `room.startAudio()`. The first tap anywhere does the
  same. If playback is still blocked, the room shows **Tap to enable audio**
  (`features/meeting/useAudioPlayback.ts`).
- **Screen Wake Lock** while the session is live, re-acquired when the tab becomes visible again
  (`useWakeLock.ts`). Browsers without the API simply skip it.
- **Loudspeaker**: on Android phones whose browser supports `setSinkId`, LiveKit audio and the
  translated clips are switched to an output labelled "speaker". iOS Safari does not let pages
  choose the output; use the system audio route there.

**Error states** (each has a message and a recovery action):

| Situation                             | What the user sees                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera / microphone permission denied | How to allow it (lock icon → Allow; iPhone: Settings → Safari), button **Reload** (lobby and room)                                                         |
| Microphone in use by another app      | "…used by another app. Close that app, then try again." button **Try again**                                                                               |
| No camera / microphone found          | "No microphone found. Plug one in or pick another in Devices." button **Try again**                                                                        |
| LiveKit unreachable                   | "Can't reach the meeting server" + **Retry** (see above)                                                                                                   |
| TransVoice API down (circuit open)    | "Translation is temporarily unavailable. It resumes by itself." The circuit half-opens after 30 s and the notice clears with the next translated utterance |
| Payer's minutes at 0                  | "The host's minutes have run out…" with **Message host** (opens chat, free) and **Subscribe**; the paying speaker gets **Subscribe** only                  |

### 4. Load test (`pnpm load:translate`)

`tests/load/translate-load.test.ts` runs the real fan-out code (per-language parallel calls, HTTP
client, retry, timeout) for **8 participants in 3 languages** (3 × bn-BD, 3 × en-US, 2 × es-ES; every
utterance goes to the two other languages) against a local mock TransVoice server returning
production-sized payloads. It is **not** end to end: the TransVoice latency is synthetic
(300 ms + exponential tail with a 150 ms mean; change with `LOAD_MOCK_BASE_MS` / `LOAD_MOCK_EXTRA_MS`),
Supabase is a fixed object and LiveKit delivery is a 3 ms stub. It therefore shows what our code
adds on top of the API. Other knobs: `LOAD_SECONDS`, `LOAD_MEAN_GAP_S`, `LOAD_BURST_ROUNDS`.

Result on the development machine (one Node process):

| Scenario                                       | Measure                            | p50    | p95    | max     |
| ---------------------------------------------- | ---------------------------------- | ------ | ------ | ------- |
| Conversation: 8 speakers, 1 utterance/8 s each | utterance (slowest language)       | 532 ms | 872 ms | 947 ms  |
|                                                | **our overhead** (utterance − API) | 8 ms   | 21 ms  | 23 ms   |
| Worst case: all 8 speak at once, ×10           | utterance (slowest language)       | 516 ms | 828 ms | 1204 ms |
|                                                | **our overhead** (utterance − API) | 20 ms  | 30 ms  | 38 ms   |

No failed calls; the event loop stayed responsive (p95 ≈ 11 ms, which is the sampler's 10 ms
resolution). Re-measure the real API with the `translate` log lines (`apiMs`, `totalMs`) in
production; the p95 there is dominated by Triton, not by this server.

### 5. Smoke-test checklist (after `docker compose up -d --build`)

Server:

1. `curl -s https://meet.transvoice.ai/api/health` → `{"status":"ok"}`; `docker ps` shows `healthy`.
2. `docker logs transvoice_meeting_app 2>&1 | grep '"event":"sweep"'` shows nothing wrong after start-up.

Two devices (laptop + phone; repeat with an iPhone if available):

3. Laptop: Start meeting → in the room, Invite Partner → copy link. Phone: open link, sign in, Join. The Join tap
   unlocks audio; the room opens without a "Tap to enable audio" bar. On iPhone Safari, if the bar
   shows, tap it once and it goes away.
4. Laptop **Start** → both "Live". Video and voice both ways; mute shows on the other side.
5. Translation: Bangla on the laptop → English voice and captions on the phone, and back.
6. Phone: lock/unlock the screen or switch tabs while live: the screen stays on while the tab is
   open (Wake Lock) and sound resumes after returning. (Android) audio comes out of the loudspeaker.
7. Connecting wording: open the room with the network throttled: header "Connecting…". Block
   `*.livekit.cloud` for 15 s (or go offline before opening the room): "Can't reach the meeting
   server" + Retry; **Retry** after restoring the network joins normally. Pull the network for
   ~10 s inside a live call: "Reconnecting…", then it recovers.
8. Permissions: deny the microphone in the browser and join → the permission message with
   **Reload**. Open the microphone in another app (phone call, other tab) and join → "used by
   another app" + **Try again**.
9. Minutes: set the host's balance to 0 and speak as the guest → "The host's minutes have run
   out…" with **Message host** (opens chat) and **Subscribe**.
10. TransVoice down: point `TRANSVOICE_API_URL` at a dead host (staging only) → after a few failed
    utterances the "temporarily unavailable" notice; restore it → translation resumes by itself
    within ~30 s.
11. Sweeper: start a meeting, close both tabs, `docker restart transvoice_meeting_app` within
    the grace period. After the restart + `RECONNECT_GRACE_SEC`: the log has
    `"event":"sweep"` with `sessionsEnded: 1` and
    ```sql
    select status, end_reason from call_sessions order by created_at desc limit 1; -- ended, reconnect_timeout
    select count(*) from participant_segments where disconnected_at is null;       -- 0
    ```
12. Shutdown: in a call with translation running, `time docker stop transvoice_meeting_app`:
    finishes in under 30 s (10 s drain at most), logs `{"event":"shutdown","signal":"SIGTERM"}`;
    exit code 143 is normal. The next utterance during the restart is retried once after 2 s.
13. Ringing: call someone and let it ring 30 s → "did not answer"; the session is `missed`.

## Fix — host and guest in different rooms (branch `fix-room-session`)

**Symptom:** the host is "Live 01:48", the guest opened the invite link but sits on "Waiting for
host to start…" and "Waiting for partner…"; both are alone in their LiveKit rooms.

**Root cause (historical: the dashboard button that caused it was removed in `ux-single-invite`).** A room is `tv-<call_session id>` and a meeting has at most one open
(`ready`/`live`) session, so two people in the _same meeting_ always share a room. The two were in
different _meetings_: dashboard **Invite Partner** (no meeting id) called `create_invitation`,
which inserted a **new meeting for every link**. A host who pressed **Start meeting** (meeting A,
live) and then made a link from the dashboard (meeting B) gave the guest a link to B. The guest's
room page opened B's session ("ready", never started) while the host was live in A. The sweeper
was not the cause (it cannot end a live session whose host is in the room) but had two hazards,
fixed below.

**What changed**

| Area                | Change                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_invitation` | Without a meeting id it reuses the host's **current meeting** (one with an open session, or created in the last 6 h with no session yet); only creates a new meeting if there is none. Returns `reused`. The modal says which meeting the link opens and links the host to it |
| `open_call_session` | Locks the meeting row, so concurrent openers (host, two guests, double click) all get the one open session; returns `created`. The unique index `call_sessions_one_open_per_meeting` stays as the backstop                                                                    |
| Room name / token   | Unchanged by design: `tv-<session id>`, and `/api/livekit/token` only admits to an open session of a meeting the user may join. Tested: host and guest tokens carry the same room                                                                                             |
| Room state          | `ensureRoom` never writes an older state over a newer one (a page render that read `ready` just before Start used to be able to reset a live room). The room also asks `GET /api/calls/[id]/state` on mount and every 4 s while it says "ready"                               |
| Sweeper / grace     | A failed LiveKit lookup no longer counts as "nobody is there" (only a 404 does); a `ready` session is judged after 5 min, a live one after `RECONNECT_GRACE_SEC`                                                                                                              |
| Logs                | `{"event":"room","action":"session_created"\|"session_reused"\|"token_issued","meetingId","sessionId","room","role","status"}`: ids only                                                                                                                                      |
| Join with link      | Accepts a full invite URL, the bare code, or a link pasted inside a message                                                                                                                                                                                                   |
| Dashboard           | States that **Start meeting** always opens a **new** meeting and that **Invite Partner** uses the meeting you are in                                                                                                                                                          |

**Deploy**

```sh
git checkout main && git merge fix-room-session        # or deploy the branch
pnpm dlx supabase db push        # 20261025000200_single_open_session, 20261025000300_sweeper_idle_since
pnpm db:types                    # replaces the two hand-edited signatures in database.generated.ts
docker compose up -d --build
```

The migrations drop and recreate `open_call_session`, `create_invitation` and
`stale_open_sessions` (new return columns), so run `db push` **before** the new container starts;
the old container keeps working until you rebuild, but an old container with the new database
reads `create_invitation` rows without `reused` (harmless).

**Check after deploy**

1. Host: dashboard → **Start meeting** → room → **Start** (Live) → **Invite Partner** in the room →
   copy the link. (The dashboard no longer has an Invite Partner button; see "Invite Partner only
   in the room" in deploy-phase-3.md.)
2. Guest (other browser/device): open the link → Accept → Join. The guest shows **Live** and the
   timer at once and sees the host's video.
3. `docker logs transvoice_meeting_app 2>&1 | grep '"event":"room"'`: one `session_created`, then
   `session_reused` for the guest, and two `token_issued` lines with the **same `room`**.
