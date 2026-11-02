# Why utterances are dropped as silence: investigation (2026-11-02)

Roles in the last test (session `b62587c2`): the HOST spoke English (`en-US>bn-BD`), the GUEST spoke
Bangla (`bn-BD>en-US`). Earlier summaries had these two labels swapped.

## Cross-capture check (item 3)

Every utterance now carries what its device knew at speech start (`vadMs`, `clipMs`, `voiceMs`,
`micDb`, `outDb`, see `lib/translation/capture-context.ts`), shown in the `?debug=1` overlay under
"recent utterances" (flagged "mic could hear the other side") and written to the `translate` log
line as `capture` next to `speakerLang`. Numbers only. The output level comes from an analyser on the
translated-clip output and from LiveKit's audio level of the partner's original voice (it ignores
the local volume setting, so it can over-report a ducked voice).

What the existing logs say about the last session. The browser did not send this context yet, so it
is estimated from the server log: speech window = request start minus the upload length plus the
300 ms pre-speech pad, up to request start minus the 400 ms end wait; the partner's translated
clip is taken to play from its `listen` beacon for max(1 s, the original's length). "Could hear" =
the other person was speaking, or their translated clip was playing here, from 1.5 s before this
speech started until it ended. Timing error is about 0.5 s.

|                             | silences | other side audible within 1.5 s | quiet |
| --------------------------- | -------- | ------------------------------- | ----- |
| host (English)              | 4        | 0                               | 4     |
| guest (Bangla)              | 8        | 0                               | 8     |
| successful utterances, both | 18       | 0                               | 18    |

So in this session none of the 12 silences happened while the other device could have been heard by
the microphone (the two people took turns), and the 18 successful utterances look the same.
Speaker bleed is not supported as a cause by this data. The real per-utterance numbers will come from
the next test.

## VAD segmentation (item 4)

### Current settings (`features/translation/vad-gate.ts`, Silero v5 via @ricky0123/vad-web)

| Setting                           | Value                                           | Env                                           |
| --------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| positive speech threshold         | 0.5                                             | none (code)                                   |
| negative speech threshold         | 0.35                                            | none (code)                                   |
| redemption (end-of-speech wait)   | 400 ms (about 12.5 frames of 32 ms)             | `VAD_END_SILENCE_MS`, 300 to 700, default 400 |
| pre-speech padding                | 300 ms (about 9 to 10 frames)                   | none (code)                                   |
| min speech                        | 300 ms                                          | none (code)                                   |
| max utterance / max chunk         | 12 s / 6 s                                      | `VAD_MAX_CHUNK_MS` (max chunk)                |
| own minimum in the chunk streamer | 10 speech frames (320 ms) at probability >= 0.5 | none (code)                                   |
| upload chunk                      | 16 frames = 512 ms                              | none (code)                                   |

Pre-speech padding is 300 ms, not under 300 ms.

### Durations of dropped and successful utterances

Only the current container's log is left (older container logs were wiped by the rebuilds), so the
"last 3 sessions" are: `b62587c2` in full, and `3fa05f80` for the English speaker only (from the
upload sizes I printed earlier). The two other recent sessions had no translated utterances.
Duration = (WAV bytes - 44) / 32000 s; it includes the 300 ms pad and the speech tail.

| Session / speaker          | Outcome    | n   | min  | median | max  | under 1.0 s | exactly 0.512 s |
| -------------------------- | ---------- | --- | ---- | ------ | ---- | ----------- | --------------- |
| `b62587c2` host (English)  | translated | 4   | 1.18 | 1.66   | 1.95 | 0           | 0               |
|                            | dropped    | 4   | 0.51 | 1.15   | 1.98 | 1           | 1               |
| `b62587c2` guest (Bangla)  | translated | 14  | 1.50 | 1.82   | 3.62 | 0           | 0               |
|                            | dropped    | 8   | 0.51 | 0.51   | 1.54 | 5           | 5               |
| `3fa05f80` English speaker | translated | 11  | 0.99 | 1.44   | 2.37 | 1           | 0               |
|                            | dropped    | 18  | 0.51 | 1.28   | 3.52 | 5           | 5               |

- 11 of the 30 dropped utterances (37%) are under 1.0 s, and all 11 are EXACTLY 16,428 bytes
  (0.512 s = 8192 samples = one 16-frame chunk). No translated utterance is shorter than 0.99 s.
- A finished utterance has at least 10 speech frames plus the pad, so it can never be that short.
  The only way a bare first chunk gets processed is the server's idle flush (3 s after the last
  chunk). These are therefore NOT speech that the STT missed: they are false starts the browser
  gave up on (fewer than 10 speech frames) whose first chunk was still processed.
- Likely mechanism (read from the code, not observed): the first chunk is admitted by the server
  first (rate limit and context load, about 200 to 300 ms) while the browser's `x-abort` request
  can arrive sooner; `discard` then finds nothing, and the chunk that arrives afterwards is kept and
  flushed. Each such false start costs one STT call and shows up as a "silence".
- Without those, English speech is still dropped much more than Bangla: English 16 real-length
  drops vs 15 translated (52%); Bangla 3 vs 14 (18%).

### Proposals (NOT applied)

The VAD values themselves do not need to change: padding is 300 ms and every drop under 1.0 s is a
sub-320 ms false start that the browser already discards. Two small changes remove the false
starts' cost instead:

1. Server `lib/translation/chunks.ts`: remember an aborted utterance id for 60 s (a tombstone), so a
   chunk that arrives after its `x-abort` is refused. No env.
2. Browser `features/translation/chunk-stream.ts`: hold back chunk 0 until the speech has 10 speech
   frames, so nothing is uploaded for a false start. No env.

If you still want segmentation knobs, the values I would use are `VAD_MIN_SPEECH_MS=400` (now 300)
and `VAD_PRE_SPEECH_PAD_MS=400` (now 300); neither env exists yet, and the synthetic test (a
clipped 150 ms onset is still transcribed) gives no evidence that they help.

## The two upstream 520 errors at 18:01 (item 5)

Both are `stt: responded 520` from `POST /v1/stt` (the split pipeline's speech-to-text step; HTTP 520
is Cloudflare's "unknown error from the origin"), the only upstream errors in the current container's
log. Both hit the GUEST (Bangla, `bn-BD>en-US`) of session `b62587c2`:

|                                                  | 18:01:01                                              | 18:01:19                                   |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| upload                                           | 115,756 B (3.6 s)                                     | 58,412 B (1.8 s)                           |
| error logged after the `translate_decision` line | 0.17 s                                                | 0.12 s                                     |
| what happened next                               | single-call fallback (`POST /`) succeeded in 3,900 ms | single-call fallback succeeded in 2,401 ms |
| utterance total                                  | 4,436 ms                                              | 2,843 ms                                   |

- They are fast failures (well under the 4 s step limit), not timeouts.
- They do not correlate with long uploads: one was 3.6 s, the other 1.8 s, which is the median
  utterance length (1.82 s). Two events cannot show more than that.
- Rate: 2 of 30 utterances processed by the split pipeline in this container (7%); 28 others had
  no STT error. Cost to the user: the fallback added about 2.4 to 3.9 s; nothing was dropped.
- What the app can tell: only the step ("stt"), the status (520) and the timestamp. `transcribe()`
  does not read the error body or headers, and the log line carries no endpoint URL, call duration,
  upload size, or Cloudflare `cf-ray` id. That is not enough to ask the API owner for a trace.
- Proposal (NOT applied): on a failed split step log `status`, the call's duration in ms, the
  audio bytes and the response's `cf-ray` header (no body, no key). With that, a 520 can be matched
  to the API server's own log.

## Correction to an earlier report

In `docs/deploy-report.md` I described the host's `listen` beacons as "2.9 to 8.1 s of audio".
`audioMs` in that beacon is the delay from the end of the speech to the first sound of the clip, not
the clip length. The conclusion (every translated clip was played on the host) still holds, since the
beacon is only sent when playback starts.
