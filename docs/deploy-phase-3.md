# Deploying Phase 3

Phase 3 ships in three checkpoints (spec: [PHASE-3.md](PHASE-3.md)). This file grows with each
one; 3C adds the pg_cron steps and the two-account smoke test.

## Checkpoint 3A — make translation work, then make it fast

### 1. Migration

| File                                          | What it does                                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261026000100_admit_keeps_session_settings` | `admit_participant` writes a participant's languages and payer once, when they first join the session; later token requests (reconnect, reload, Retry) no longer overwrite them with profile defaults |

```sh
pnpm dlx supabase db push
```

### 2. Environment (`.env.production`)

| Variable                   | Default | Meaning                                                                                                                                                                |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VAD_END_SILENCE_MS`       | `400`   | Silence (300–700) that ends an utterance. Lower = faster, but a breath can cut a sentence                                                                              |
| `TRANSVOICE_WARMUP_SEC`    | `30`    | Keep-alive ping to the TransVoice API while a session is live (`0` = only the boot ping). If the boot log shows `keepAlive":"timeout=N"` with N < 30, set this below N |
| `TRANSVOICE_OUTPUT_FORMAT` | `wav`   | `mp3` or `opus` only after your API supports `output_format` and returns `audio_format`/`output_format` in its answer. Leave `wav` until then (nothing changes)        |

Unchanged: `TRANSLATION_BETA_ALLOWLIST` (keep your accounts), `REDIS_URL` (optional).
Rebuild: `docker compose up -d --build`. Open rooms must be reloaded once (the client changed).

### 3. First checks after deploy (2 minutes)

```sh
# Can the container reach the TransVoice API? (printed at every start)
docker logs transvoice_meeting_app 2>&1 | grep transvoice_warmup
#   {"event":"transvoice_warmup","reachable":true,"status":405,"keepAlive":"timeout=5",…}
#   reachable:false  → DNS / firewall / wrong TRANSVOICE_API_URL (detail says which)
#   any HTTP status  → the network path and TLS work (401/404/405 on a bare GET are normal)

# VAD assets and their types (wasm must be application/wasm)
curl -sI https://meet.transvoice.ai/vad/ort-wasm-simd-threaded.wasm | grep -iE "^HTTP|content-type"
curl -sI https://meet.transvoice.ai/vad/silero_vad_v5.onnx | grep -iE "^HTTP"

# Nginx must accept uploads of up to 2 MB (default is 1 MB): in the server block
#   client_max_body_size 2m;
nginx -T 2>/dev/null | grep client_max_body_size
```

### 4. Debugging a call: `?debug=1`

Open the room as `https://meet.transvoice.ai/m/<meetingId>?debug=1` (only for the accounts on
`TRANSLATION_BETA_ALLOWLIST`). The panel at the bottom left shows, live:

| Line               | What it tells you                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `VAD`              | `loading model…` / `loaded, paused` / `listening` / `speech detected` / `error: …`                                          |
| `gate`             | OPEN/closed with the reason: session status, people connected (from LiveKit), mic on/MUTED, a clip playing, translation off |
| `livekit`          | connection state and the number of remote participants                                                                      |
| `last utterance`   | length, size, how long ago                                                                                                  |
| `/api/translate`   | the HTTP status and milliseconds of the last upload (`402/403/503` say why: minutes, beta gate, LiveKit)                    |
| `last caption`     | language and age of the last caption received                                                                               |
| `last audio`       | `url ok in N ms`, `url 404` (clip expired or not yours), `inline …`                                                         |
| `playback queue`   | clips waiting                                                                                                               |
| `AudioContext`     | `running` / `suspended` (tap the page) / `none`                                                                             |
| `me` / `listeners` | your spoken/listen language and the languages the server translated into; `none (same language)` = nothing to translate     |

Reading it: gate closed → fix that line first. Gate OPEN but `last utterance` stays `—` → the VAD
does not hear speech (mic, `VAD` line). Utterance sent but `/api/translate` is not 200 → that status.
200 but no caption → `listeners` empty (same language) or the API failed (`docker logs … | grep
'"outcome":"failed"'` shows `status` 401/404/timeout per language pair).

### 5. What was found while reviewing the translation path

Production could not be observed from the repository, so these are defects found in the code,
not a reproduction of what you saw. Each has a test.

1. **Session languages and payer were reset on every token request.** `admit_participant` upserted
   the participant row each time a LiveKit token was issued (reconnect, Retry, page reload) with
   the profile's languages and today's payer. A language changed in the room silently reverted;
   a sponsorship window that ended mid-call would have moved the guest's minutes. Fixed in the
   migration above; the lobby also copies its choice into an existing row.
2. **A LiveKit API hiccup answered "403 you are not connected"** (and was cached for 2 s).
   `/api/translate` now answers `503 LIVEKIT_UNAVAILABLE`, logs it and does not cache it.
3. **Matching languages looked like a bug.** Two accounts on the default (en-US/en-US) get an
   empty fan-out by design, with no sign why. The response now says `same_language` or
   `no_listeners` and the room shows a hint; the debug panel shows it too.
4. **API failures were invisible.** The log now carries `status` (401 = wrong key, 404 = wrong
   URL), a content-free `detail` and the language `pair` for every failed language; the boot
   ping reports reachability.
5. The clip cache is kept on `globalThis` so `/api/translate` and `/api/tts/[id]` always share it.

Checked and found correct: the VAD gate (session live, ≥ 1 _LiveKit remote participant_, mic on,
nothing playing); `meeting_participants` rows carry languages and `payer_id` for host and guest;
data messages are addressed by LiveKit identity = user id; the production build serves
`/vad/*` with the right types and a CSP that allows WASM (checked against a production build).
**Not run here:** real-browser tests (this server has no Chromium libraries) and anything against
production LiveKit or the TransVoice API.

### 6. Latency: measure before and after

Each browser reports what it measured to `POST /api/latency`; the server logs one JSON line (no
user data) next to the per-stage `translate` lines. After a few test calls:

```sh
docker logs --since 1h transvoice_meeting_app 2>&1 | pnpm latency:report
```

prints p50 / p95 / max per stage and per language pair and checks the targets (speech end →
translated audio start: p50 ≤ 1.8 s, p95 ≤ 3 s). "Speech end" is when the speaker really stopped
(the VAD's silence wait is subtracted). Listener times compare two devices' clocks, so keep both
on automatic time. **Take a baseline first**: do one 5-minute test call on the previous
container's logs (or before deploying) and keep the report, then compare.

What changed for speed (one commit each, none measured in production yet):

| Change                               | Effect                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep-alive pool + warm-up ping       | Measured locally, 3 requests 5 s apart: Node's default pool opens 3 connections, ours 1 — if the API does not announce a shorter keep-alive. If it does (e.g. `timeout=5`), lower `TRANSVOICE_WARMUP_SEC` |
| VAD wait 500 → 400 ms                | Every utterance starts 100 ms earlier (by construction)                                                                                                                                                   |
| Audio sent together with the caption | One sequential LiveKit API round trip less before the listener can fetch the clip                                                                                                                         |
| Inline compressed clip (≤ 12 KiB)    | No HTTP fetch for short clips — only with `TRANSVOICE_OUTPUT_FORMAT=mp3\|opus` and an API that reports the format                                                                                         |

### 7. Manual test (two devices)

1. Both accounts: Settings → different languages (e.g. laptop speaks Bangla / hears Bangla, phone
   speaks English / hears English). Allow-listed host.
2. Host starts a meeting, guest joins; both open the room with `?debug=1` once.
3. Speak a sentence on the laptop, pause ~0.5 s. Phone: caption + translated voice. Panel on the
   laptop: gate OPEN → `last utterance` → `/api/translate 200`; on the phone: `last caption`, `last audio url ok`.
4. Reload the phone's page in the middle of the call: its languages stay as you set them.
5. Run `latency:report` as above.
