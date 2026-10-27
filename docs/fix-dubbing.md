# fix-dubbing — evidence, changes, deploy

Branch `fix-dubbing` (merged into `main` locally, not pushed). One commit per item.

## A. Host → guest translated (Bangla) voice silent

### What was measured (live API, one request at a time)

| Case                                                                | Result                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `bn-BD` / `bn-IN`, male + female voices, via `POST /` and `/v1/tts` | audible 16 kHz mono WAV, 5.9–7.5 s, peak 0.52–0.68, RMS 0.07–0.09 |
| English voice (`en-US-…`) with `tgt_lang: bn`                       | **44-byte WAV, 0 samples** (HTTP 200)                             |
| Unknown / misspelt voice on `POST /`                                | `tts_audio: null` (HTTP 200)                                      |
| Unknown voice on `/v1/tts`                                          | HTTP 502, 16 bytes                                                |
| `output_format: mp3` / `opus` on `POST /`                           | ignored: always `RIFF` WAV, no `audio_format` field               |

So a correct Bangla voice is not silent at the API. The failure that matches "guest fetches `/api/tts` → 200,
playback 'starts', beep and original voice work" is a clip with no samples: the old code accepted it as a
translation (`tts_audio` empty-WAV passed the schema), cached it, and the guest "played" 0 ms. A `null`
`tts_audio` was rejected as "unexpected payload" (one such `failed … 200` line was in the logs).

**Not proven:** which of these (or a device-side cause) produced the silence in the user's session. The
production logs of that session were gone (container rebuilt before they were read) and no clip size / peak
was ever logged. The new logging below will show it on the next occurrence. Voice mapping for every listed
language is now tested (male + female, locale-matching, `Neural`), and `bn`, `bn-BD`, `bn-IN` resolve.

### Changes

1. **A1** server: every clip is measured (bytes, rate, channels, seconds, peak, RMS) and logged as
   `translate_decision` with `decision: clip:ok | clip:empty | clip:silent | clip:missing | clip:invalid`
   (warn level when not ok; no text/audio). Empty (< 0.2 s), inaudible (peak < 0.01) or null clips are
   retried **once with the other gender's voice**; if that also fails the listener gets the caption plus the
   notice "Audio unavailable for this utterance — showing captions." `findVoice()` never returns an English
   voice for a non-English language (it borrows a same-language locale, else none).
2. **A2** client: per decoded clip duration / rate / channels / peak / RMS, gain (explicit `GainNode`, always
   1.0), AudioContext state at start, original-voice volume at start and end — in the `?debug=1` overlay with
   **Replay last clip** and **Download last clip** (WAV). A decoded clip with peak < 0.01 or < 0.2 s is
   reported to `/api/diag` as `clip_quiet`. Audit: no mode (`off` 1 / `duck` 0.15 / `mute` 0) touches the
   translated clip; they only set the volume of the speaker's _original_ LiveKit track.
3. **A3** `GET /api/translate/voices[?lang=bn-BD]` (allow-listed hosts): static check of the whole mapping
   plus, per requested language (max 3), both voices asked from `/v1/tts` sequentially. Overlay button
   **Voice self-test**.

## B. Latency

### Baseline — what could and could not be measured

- `docker logs transvoice_meeting_app | pnpm latency:report` → **0 utterances**: the container had just been
  rebuilt, so there was no production traffic to report. No production p50/p95 exists; none is claimed.
- Network from this host (3 runs each, `curl`): TransVoice API TCP 19–23 ms, TLS done 47–52 ms, first byte
  211–307 ms (`GET /`, 405); LiveKit Cloud TCP 54–91 ms, TLS done 87–122 ms, first byte 111–146 ms.
- API round trip for a 3.5 s Bangla utterance → English, one request at a time from this host (WAV upload):
  **2817–4012 ms, p50 3280 ms (n = 5)**. This alone is above the 1.8 s p50 target; the API (ASR + MT + TTS of a
  ~3.5 s clip) dominates, not the network. The API's response has no `asr_ms/mt_ms/tts_ms` fields.

### Changes

- **B2** `UPLOAD_FORMAT=opus|wav` (default `wav`): Ogg Opus via WebCodecs `AudioEncoder`, wav fallback when
  unavailable. Measured: 112,844 B WAV → 8,910 B Ogg Opus (−92%). API accepts it (decoded identically);
  round trip p50 **3280 ms (wav) vs 3036 ms (webm/opus), n = 5 each** — a difference within the noise on a
  fast link, so the gain is bandwidth (slow uplinks), not proven latency. Keep `wav` unless uplinks are slow.
- **B3** `TRANSVOICE_OUTPUT_FORMAT=mp3|opus`: the API ignores `output_format` today (always WAV, no
  `audio_format`), so the existing feature-detected inline path (≤ 12 KiB over LiveKit data) is not exercised;
  nothing changed, leave it at `wav`.
- **B4** `VAD_MAX_CHUNK_MS` (default 5000): a longer speech is cut live at the latest pause ≥ 250 ms and sent in
  pieces with a group id + sequence number, one after the other so the per-speaker queue plays them in order.
- **B5** if the API sends `timings` (or flat `asr_ms/mt_ms/tts_ms`) they are logged per language and
  `pnpm latency:report` prints them, plus the VAD wait and round trip / size per upload format.
- The keep-alive pool and 30 s warm-up (undici) were already in place and are unchanged.

## C. Call sounds

Web Audio two-tone ringtone (incoming modal) and 440+480 Hz ringback ("Calling…"); stop on accept, decline,
cancel, miss, unmount. Shared AudioContext unlocks on the first tap/click/key on any signed-in page; the
dashboard shows a one-time "Enable call sounds" banner if still blocked. Title flash, `navigator.vibrate`,
and a Notification (permission asked only from a click: the banner or Settings). "Mute call sounds" is in
Settings (and in the modal), stored per device in `localStorage` — no migration.

## Deploy checklist

1. No migrations.
2. Optional env (defaults are safe): `UPLOAD_FORMAT=wav`, `VAD_MAX_CHUNK_MS=5000` (see `.env.example`).
3. `docker compose --env-file .env.production up -d --build` (keep the 172.17.0.1:3003 binding).
4. Check: `docker logs transvoice_meeting_app | grep '"decision":"clip:'` after a test call; open a room with
   `?debug=1`, press **Voice self-test**, speak, read "last clip", **Replay last clip**.
5. Never send parallel requests to `POST https://speech.transvoice.ai/`.

## Not run

Playwright / real two-device calls (no Chromium libraries on this host), WebCodecs Opus encoding in a real
browser (jsdom has no `AudioEncoder`; the muxer was validated with ffmpeg and the API instead), ringtone on
real iOS/Android speakers, vibration and system notifications, and any production latency percentile.
