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

## Fix — translation still silent after 3A (branch `fix-translation`)

### What the production logs and the live API showed (2026-10-26)

Read from the running container and the live API on the Hetzner host:

1. **The Speech API rejects our key.** `POST https://speech.transvoice.ai/` with
   `Authorization: Bearer $TRANSVOICE_MASTER_API_KEY` answers `401 {"detail":"Invalid or Revoked
API Key"}` (the key in `.env.production`: 56 characters, `tv_…`, no stray spaces or quotes).
   The same key on `/v1/tts` gives the same answer, `x-api-key` instead gives `Not authenticated`.
   The contract itself matches our client: `POST /`, JSON body with `audio`, `src_lang`,
   `tgt_lang` (bare codes: default `"bn"`), `azure_voice` (and optional `voice_tone`, `action`,
   `text_in`), `Authorization: Bearer`. **No code can fix this: a valid key is needed**
   (create one in the API dashboard, put it in `TRANSVOICE_MASTER_API_KEY`, then
   `docker compose --env-file .env.production up -d --force-recreate`). The response shape could
   not be checked without a valid key.
2. **No utterance ever reached the API.** The container logged `latency … kind:"speak"` lines (the
   browser uploaded, the route answered 200 in ~1 s) but **zero** `"event":"translate"` lines, which
   are written after the API calls. So the route returned early every time with "nothing to
   translate". The stored session rows explain it
   (`meeting_participants`, language columns only):

   | role  | speaks | hears |
   | ----- | ------ | ----- |
   | host  | en-US  | bn-BD |
   | guest | bn-BD  | en-US |

   Each person is set to **hear the language the other one speaks**. "I want to hear" is the
   language _you_ understand (normally your own): what your partner says is translated **into** it.
   Here the host (English speaker) asks to hear Bangla while the guest already speaks Bangla, and
   the guest asks to hear English while the host already speaks English: both original voices are
   already in the language each wants, so the server correctly translates nothing. For two people
   to understand each other, set **I speak = I want to hear = your own language** on both sides
   (host bn/bn, guest en/en). The wording "Translate to" in the lobby invited exactly this mistake
   (it reads as "translate my speech into …"), and the "same language" hint appeared only on the
   side that had just spoken, which looked like the two screens disagreeing. They did not: each
   hint described that person's own next sentence, and the server used the stored rows for both.

### What changed

| Area                | Change                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One source of truth | `meeting_participants` of the open session decides fan-out, the hint, the Languages menu and the status line. `planFanout()` is the only place that turns those rows into targets; `/api/translate` performs it, `GET /api/translate/status` reports it. Profile, lobby choice and LiveKit participant metadata are not read by any translation path (metadata is written for display only).                       |
| Menu and reload     | The page's first render and the Languages menu show the stored row (the profile used to be shown, which could differ after a reload); the menu shows what the server confirmed, and the room refreshes every 3 s, so the partner's change appears within 3 s                                                                                                                                                       |
| Status line         | Always visible above the captions: `You speak Bangla → Atikul hears English · You hear Atikul in Bangla`, `Same language: nothing to translate`, or — for the mix-up above — `Nothing is translated: you each hear the other's own language` with a one-tap `I want to hear Bangla`                                                                                                                                |
| Wording             | Lobby `Translate to` → `I want to hear`, with an explanation; the Languages menu explains it too                                                                                                                                                                                                                                                                                                                   |
| Language codes      | `bn`, `bn-BD`, `bn_BD`, `BN-bd` / `en`, `en_US`, `en-US` compare as the same language everywhere: fan-out grouping (en and en-US were two API calls), `src_lang`/`tgt_lang` (always the bare code, e.g. `bn`), the Whisper lookup and the Azure voice (a bare code used to get the default English voice). Chinese traditional vs simplified and Cantonese stay distinct. The Languages route stores one spelling. |
| Debug overlay       | `?debug=1` now works for any signed-in participant (a `*` allowlist used to hide it from everyone). Shows both people's stored languages, where my sentences go, the allowlist decision, whether the API accepts our key, a live mic level, whether the 4 `/vad` files load, CSP violations, and a **Send test clip** button                                                                                       |
| Status endpoint     | `GET /api/translate/status?sessionId=…` (participants only; display names + languages, no ids/emails)                                                                                                                                                                                                                                                                                                              |
| Logs                | One `translate_decision` line per `/api/translate` call, also when nothing is translated: speaker language, listener languages, targets, decision (`translate`, `same_language`, `no_listeners`, `blocked:<code>`, `rejected:<code>`)                                                                                                                                                                              |
| API key             | A 401/403 from the API is reported to the speaker as "the translation service rejected our access key" instead of a generic hiccup                                                                                                                                                                                                                                                                                 |
| Kill switch         | `TRANSLATION_ENABLED=false` turns translation off for everyone (calls go on)                                                                                                                                                                                                                                                                                                                                       |

No migration. New optional variable: `TRANSLATION_ENABLED` (default `true`).

### After deploying

```sh
docker compose --env-file .env.production up -d --build
docker logs transvoice_meeting_app 2>&1 | grep -E 'transvoice_warmup|translate_decision|"event":"translate"' | tail
```

1. Put a valid `TRANSVOICE_MASTER_API_KEY` in `.env.production` (see 1 above) and recreate the container.
2. Both people: lobby/menu **I speak** = **I want to hear** = own language (host Bangla/Bangla, guest English/English).
   The line above the captions should read `You speak Bangla → … hears English`.
3. Open the room with `?debug=1` (e.g. `/m/<id>?camera=on&mic=on&debug=1`). Check `service … API key accepted`,
   `vad files 4/4 ok`, `blocked by CSP none`, `mic level` moves when you talk, `gate OPEN`.
4. Speak, pause 1 s. If nothing arrives: **Send test clip** prints the exact status and body; the log shows
   `translate_decision` and, for each language, `status`/`detail` of a failed API call.

## Invite Partner only in the room (branch `ux-single-invite`)

The dashboard no longer has an **Invite Partner** button (nor its helper text). Inviting happens
inside the room, for the meeting you are in: the control bar button, and a big **Invite Partner**
button in the empty room (host). Dashboard keeps **Join with link**, **Start meeting** and
**Your connections → Open room / Call**.

- `createInvitation` (server action) now **requires a `meetingId`**: a missing or malformed one is
  refused (`MEETING_REQUIRED`) before auth or any database call, and a meeting you are not part of
  is `NOT_ALLOWED`. An invitation can never create a meeting.
- `create_invitation` (SQL) still accepts a null meeting for compatibility; nothing in the app calls it
  that way (tests cover both sides).
- The dashboard User Manual step 2 reads: "Click Start meeting, then press Invite Partner inside
  the room and share the link (WhatsApp, LinkedIn, email)."

**Deploy:** no migration, no new variables.

```sh
docker compose --env-file .env.production up -d --build
```

**Check:** dashboard shows only _Join with link_ and _Start meeting_; Start meeting → room: the empty
room shows a big **Invite Partner** button; the link it creates opens this same meeting for the guest.
Old browser tabs that still show the dashboard button get an error when they use it (the action changed).

## Fix — host audio, ringing, reusable links, invite email (branch `fix-audio-invite`)

### Evidence and root causes

**1. Host's voice not heard by the guest (original or translated).** From 24 h of production logs:
the host's English was translated (`en-US>bn-BD`: 3 speech results + 3 "Silence"), the server
delivered all 3 (`audioMs` ≈ 390 ms), the guest fetched all 3 clips (`/api/tts` 200 ×23 in nginx = every
speech clip) and the guest's browser **started playing all 3** (`listen` beacons for `bn-BD`). So the
server, LiveKit data path and fetch were fine; what is audible is decided in the browser or the
device. The logs cannot tell which, so the code was hardened on every path that can silence a
voice and the overlay now shows the state that was invisible:

- Ducking could leave the original voice lowered if a clip hung (a suspended `AudioContext` accepts
  `start()` and never plays or ends). The voice is now lowered only right before a clip plays and put back
  when it ends, fails, hangs past length + 3 s, the tab is hidden or the audio context stops; a stale,
  undecodable or blocked clip never lowers anything; `playBuffer` fails fast on a suspended context.
- The VAD listens to a **clone** of the published microphone track (same capture, no second
  `getUserMedia`; stopping it cannot mute/end the track LiveKit sends); a test forbids any other capture
  in the room. A watch logs (`docker logs … | grep '"event":"client"'`) if the published track is muted or ends.
- A guest joining a live room never presses Start: `room.startAudio()` now also runs on the first tap or key.
- The "who is connected" cache is refreshed on join/leave webhooks.
- `?debug=1` now shows: my mic track (published / LiveKit muted / readyState), every remote mic track
  (subscribed, muted, **volume**), the last ducking event, and a **Play test beep** (proves sound can leave
  this device). Next test: if the guest hears nothing, open `?debug=1` on the guest: `their mic tracks …
volume` below 1 or `last ducking … lowered` stuck means ducking; `AudioContext suspended` or a silent
  beep means the browser/device; `NOT subscribed` means LiveKit.
- Also seen: 3 of 6 host sentences came back "Silence" from the API (vs 3 of 23 for the guest): check the
  host's microphone level in the overlay (`mic level`).

**2. Ringing.** In production **no `ringing` session was ever created**: `create_call` rang only a sponsored
guest's _sponsor_, and the host pressing **Call** got `direct` (every `POST /api/calls` in the nginx log is an
87-byte "go to the lobby" reply). The Realtime policy `user channel: receive own` is present (queried).
Fixed: the host's Call rings the guest of the meeting (also while the host sits in the room; Accept joins
that session), sponsors get **Call** + Open room, the callee's pages poll `/api/calls/incoming` every
3 s on top of Realtime, the listener is mounted on the dashboard (incl. settings/billing), lobby and room,
and one shared channel per user replaces two components fighting over supabase-js's single channel object
(either unmounting used to remove it under the other). Logs: `{"event":"notify","type":"incoming_call","ok":true}`
and `{"event":"call","action":"ringing"}` on the server; `[calls] channel SUBSCRIBED` / `incoming_call received`
in the browser console; channel failures reach the server log as `{"event":"client","type":"realtime_status"}`.

**3. Links usable once.** `invitations.max_uses` defaulted to 1. Now 20 by default (1–100 chosen in the
dialog), the same user can open the link again (same meeting, no new connection/place), a new person
can use it while places remain, revoked/expired links stop everyone but the host, "full" only stops
new people, and a link never creates a meeting or a session: after the meeting ended, opening the room
creates a new ready session on the same meeting for anyone with call rights. **Revoke this link** in the dialog.

**4. Send Invite email.** The container has none of `RESEND_API_KEY`, `SMTP_*`, `EMAIL_FROM`, so there was no
mailer and "Send Invite" went through Supabase's built-in "Invite user" mail (rate-limited default SMTP, only
new addresses, creates an unconfirmed account). Now: no mailer → "Email sending is not configured on this
server…" in the dialog (the Supabase path is opt-in: `INVITE_EMAIL_SUPABASE_FALLBACK=true`).

### Email setup (pick ONE)

Resend (recommended: one HTTPS call, no ports/TLS to debug; needs the `transvoice.ai` domain verified in Resend):

```sh
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM=TransVoice AI <no-reply@transvoice.ai>    # must be on the verified domain
```

or SMTP (the same server Supabase Auth uses is fine):

```sh
SMTP_HOST=smtp.example.com
SMTP_PORT=587          # 465 with SMTP_SECURE=true
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=TransVoice AI <no-reply@transvoice.ai>    # a sender the SMTP account may use
```

Check without the app, then recreate the container:

```sh
pnpm mail:test you@example.com        # reads .env.production; prints transport + the provider's answer
docker compose --env-file .env.production up -d --force-recreate
docker logs transvoice_meeting_app 2>&1 | grep '"event":"mailer"'    # {"configured":true,"kind":"resend"}
```

Nothing is ever logged but `{"event":"invite_email","ok":…,"via":…}` and the provider's reason: no
addresses, bodies or keys.

### Deploy

```sh
pnpm dlx supabase db push     # 20261027000100_host_rings_guest, 20261027000200_multi_use_invitations
pnpm db:types                 # replaces the hand-edited signatures in database.generated.ts
docker compose --env-file .env.production up -d --build
```

The migrations replace `create_call`, `incoming_calls` and `create_invitation` (new column / argument with
defaults, so the previous container keeps working during the switch) and add `revoke_invitation`.

### Check after deploy

1. Host: dashboard → Your connections → **Call** next to the guest: the guest's screen (dashboard, lobby or
   room of another meeting) shows "… is calling" within ~3 s; Accept lands in the host's room.
2. Open `/invite/<link>` three times as the same guest, then as a second account: all land in the same meeting;
   revoke it in the dialog and the next open says "cancelled".
3. Both sides `?debug=1`: `my mic track published`, `their mic tracks … subscribed, live, volume 1`, **Play test beep**
   is audible; speak in both directions and check `last ducking … restored to 1`.
4. `pnpm mail:test you@example.com`, then **Send Invite** in the dialog.

### Not run here

Real-browser/Playwright tests (no Chromium libraries on this host), anything against two real devices, a
real mail provider (no credentials), and the live Realtime channel (the unit tests drive the hub with a
fake client; production only shows it in the browser console).
