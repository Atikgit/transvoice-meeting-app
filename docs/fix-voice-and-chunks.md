# fix-voice-and-chunks — why the translated voice was missing, and the chunked upload

## 1. Root cause of the missing voice (evidence)

**The Speech API account is out of credit.** Measured on 2026-11-01 with the production key, one request at a time:

| Call                                 | Answer                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `POST /` (bn → en, bn → bn, bn → hi) | `402 {"detail":"Insufficient Balance. Please claim trial or buy a plan."}` |
| `POST /v1/stt`                       | `402` same text                                                            |
| `POST /v1/tts`                       | `402` same text (68-byte JSON instead of mp3)                              |

The app's own log (container started 01:50, `single` pipeline) shows the switch: one successful `bn→en` at
**02:31:04**, then `status:402` for every call from **02:31:14**, then `circuit_open` (the breaker, after 5
failures) for most of the following utterances — 22 `translate` lines, 1 speech, 10 × 402, 11 × circuit_open.
In `split` mode the translation (OpenAI) is not billed by the Speech API, so captions can still appear, while
`/v1/tts` fails with 402 for every sentence: **captions sometimes, no voice**. That matches the report.
What this does NOT prove: the logs of the earlier split session were lost when the container was rebuilt, so
I cannot show that the 402 was already happening during that exact session. It is the only failure present in
the logs and it fully explains the symptom; the clip trace below will confirm or refute it next time.

Action needed (not code): top up / claim the trial for the Speech API account.

The app now says so instead of failing silently: `GET /api/translate/status` reports `api: no_balance`, the
status line and debug overlay say "no credit left", and `/api/translate` answers `serviceNoBalance` so the
speaker sees "the translation service has no credit left".

## 2. The five suspects checked

|                | Finding                                                                                                                                                                                                                                                                                                   | Change                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a. stale drop  | The age already used the clip's **arrival** at the listener (`receivedAt`), not the speaker's speech end. But the limit was 6 s checked when the clip's turn came: the 3rd+ clip of a long, multi-sentence utterance waited behind earlier clips and was dropped. Latent bug, not proven to be the cause. | `STALE_CLIP_MS` (default 15000). Every drop is logged (`clip_drop` in /api/diag with reason and age) and shown in the overlay.                                                                            |
| b. inline size | Clips were inline when the **audio** was ≤ 12 KiB; header + length prefix made the packet up to ≈ 12.5 KiB. Raw bytes, no base64 (so no 33 % overhead). Always under the ≈ 15 KiB limit: not a cause.                                                                                                     | The cap is now on the **whole packet** (12 KiB), computed by `inlinePacketSize()` before building it; bigger → URL path.                                                                                  |
| c. seq / last  | The server numbered _sentences_; a sentence without audio left a gap, and the listener waited 400 ms for it.                                                                                                                                                                                              | Clip numbers count delivered clips only (no gaps). The listener never waits for a missing clip longer than 400 ms.                                                                                        |
| d. mp3         | `/api/tts` already served `audio/mpeg`, the whole file is `await`ed into the cache before the URL is announced, and `decodeAudioData` gets the full file. Verified by tests. Not a cause.                                                                                                                 | none (tests added)                                                                                                                                                                                        |
| e. versions    | Nothing protected an old open tab.                                                                                                                                                                                                                                                                        | Every data message carries `v` (protocol) and `build`. A newer message format → captions only + "New version available - reload"; a different build with the same format → the banner, voice still plays. |

## 3. Clip trace

Server (`clip_trace` log lines, ids and sizes only): `created` (bytes, packet bytes, inline|url),
`sent` (ok, ms, error). Listener (`?debug=1` overlay, last 20): `received`, `fetch`, `decoded` (duration,
peak), `enqueued`, `dropped` (reason, ms since arrival), `play-start` (ms after arrival), `play-end`.
Drops, failed fetch/decode and version mismatch also go to `/api/diag` (always on).

## 4. Network leg (the 8 s round trip)

Not explained from the logs: nginx's access log has no `request_time`, so the ~6 s between the browser and
`startedAt` in the route cannot be split from here. The speak beacon now carries the request's
PerformanceResourceTiming (`stalledMs` = browser queue/DNS/TLS, `waitMs` = request sent → first byte,
`downloadMs`) and the main-thread long tasks during the request (`longTasks`, `longTaskMs`);
`pnpm latency:report` prints them. Reading: big `stalled` or many long tasks = the browser;
big `wait` with a small server total = network/proxy. (Optional, not done: add `$request_time
$upstream_response_time` to nginx's log format.)

## 5. UPLOAD_MODE=chunked

`whole` (default) is unchanged. `chunked`: while the VAD reports speech, ~500 ms PCM16 chunks are posted to
`POST /api/translate/chunk` (headers `x-utterance-id`, `x-seq`, `x-last`, `x-session-id`, `x-client-ts` on
the last chunk, `x-group` / `x-piece-seq`; `x-abort: 1` discards). Server: the first chunk of an utterance is
admitted with the same checks as `/api/translate` (live session, connected participant, beta list, kill
switch, payer minutes; same answers) and spends ONE rate-limit token per utterance. Buffers live 20 s, hold
≤ 12 s, 2 open per user; chunks may arrive in any order or twice; the request that completes the utterance
runs the existing pipeline (single or split) and returns the usual answer (the others answer 202). Without a
last chunk, 3 s of silence assembles it if nothing in between is missing; a gap drops it.
Browser: every chunk has 3 s; any failure (network, timeout, 5xx, 400/409) sends the whole utterance via
`/api/translate` under the same id; if the chunks had in fact been processed the server answers
`duplicate` and does nothing twice. Decisions (401/402/403/429) are shown, not retried. A speech past
`VAD_MAX_CHUNK_MS` (default now 6000) is cut at a pause ≥ 250 ms that is happening right now; the parts are
separate utterances of one group with sequence numbers.
Not measured yet: whether chunked lowers the round trip in production (the Speech API has no credit, so no
end-to-end run was possible). Compare `latency:report` lines "round trip, upload whole" vs "chunked".

## Env vars

`STALE_CLIP_MS` (15000), `UPLOAD_MODE` (whole|chunked), `VAD_MAX_CHUNK_MS` (default 5000 → 6000).

## Deploy

1. Top up the Speech API account (nothing else will bring the voice back).
2. `docker compose --env-file .env.production up -d --build`; open tabs show "New version available - reload".
3. Optional: `UPLOAD_MODE=chunked` for one test session, then compare `latency:report`.
