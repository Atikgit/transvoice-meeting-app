# Fast pipeline (TRANSLATION_PIPELINE=split) — what it is and what was measured

Uses only what the Speech API serves today; nothing on the API server changes. Default stays `single`.

## Flow per utterance

1. `POST /v1/stt {audio, ext, lang}` **once** (4 s limit). Empty, < 2 chars or `you`, `thank you`, `i`, `am i`
   (any case, with/without the final `.`/`?`) are dropped.
2. Per distinct listener language, in parallel: streamed translation (gpt-4o-mini via OpenAI when
   `OPENAI_API_KEY` is set, else `/v1/chat` when `TRANSLATE_PROVIDER=api-chat`) with the API's own translator
   prompt and a full language name ("Bengali"). The first 8 characters are held back so a `Silence` answer is
   dropped before anything is shown.
3. Sentence streaming: split at `. ? ! । ॥` and line breaks (and at a space after 120 characters; `3.5` is not
   an end). When a sentence completes its caption (cumulative text) is sent and `POST /v1/tts {text, voice}`
   starts at once. Clips go out in order with `{utteranceId, seq, last}`; mp3 as served (`audio/mpeg`),
   ≤ 12 KiB inline over LiveKit data, larger through `/api/tts/<id>`. The listener sorts by `seq` (waits up to
   400 ms for a missing predecessor), keeps the speaker's original voice lowered from the first clip's start to
   the last clip's end (800 ms after a clip that was not marked last), and drops clips older than 6 s as before.
4. Fallback: STT, translate or TTS failing or taking > 4 s sends the language (all languages when STT fails) to
   the existing `POST /` path for that utterance; counted (`splitFailures` in the `translate` log line), and a
   separate circuit breaker routes straight to `single` while the split path keeps failing.

## `/v1/chat` contract (probed once, sequentially)

`{messages:[…]}` is required (`system` alone → 422). A system-role message inside `messages` is **ignored** (the
model chatted back); the instruction must be the top-level `system` field. The reply is streamed plain text.
Used only when `OPENAI_API_KEY` is unset and `TRANSLATE_PROVIDER=api-chat`; it needs the key's user id to be in
the API's `CHAT_ALLOWED_USER_IDS` (not checked from here).

## Voices

All 303 configured voices were requested through `/v1/tts` one at a time: **301 work**. Not usable (HTTP 502):
`zh-CN-guangxi-YunqiNeural`, `zh-CN-liaoning-YunbiaoNeural` — skipped (`UNAVAILABLE_VOICES`): liaoning uses the
female voice for both genders, guangxi has no audio (captions only). Bangla confirmed: `bn-BD-NabanitaNeural`
(female), `bn-BD-PradeepNeural` (male), `bn-IN-TanishaaNeural`, `bn-IN-BashkarNeural` — each 200 and 12–14 KB.
Azure's own voices list could not be read: this host has no Azure key (the API server holds it), so the check
is against what the API's TTS accepts, which is what the app depends on. When a voice returns no usable audio
at run time the other gender is used for the rest of that utterance and a `voice_fallback` line is logged.

## Logs and report

Per language in the `translate` line: `pipeline`, `sttMs`, `translateFirstTokenMs`, `firstSentenceMs`,
`ttsFirstByteMs`, `toFirstAudioMs` (request start → first audio handed to LiveKit/cache; also for `single`),
`sentences`, `fallback`. `docker logs … | pnpm latency:report` ends with a "Single vs split" table.

## Clock skew

Each browser pings `GET /api/time` 5 times when it joins and keeps the offset of the lowest-round-trip ping.
The speaker sends "speech ended at" in server time and the listener measures against server time, so two
devices whose clocks differ no longer inflate "speech end → audio start" (a 3 s / 5 s skew gave 9.7 s for a
true 1.7 s in the test).

## Measured here

No split-vs-single timings from real meetings exist yet (no OpenAI key on this host, so the split path could not
be run against live services; every step is covered with msw). Turn it on for one account/session, run
`pnpm latency:report`, and compare — do not trust any number before that.

## Deploy

`.env.production`: `TRANSLATION_PIPELINE=split`, `OPENAI_API_KEY=…` (or `TRANSLATE_PROVIDER=api-chat`);
`docker compose --env-file .env.production up -d --build`. Roll back with `TRANSLATION_PIPELINE=single`.
Never send parallel requests to `POST /` while testing.
