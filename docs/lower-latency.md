# lower-latency (branch from fix-voice-and-chunks)

Numbers below are from unit tests unless a row says otherwise. **No live before/after was possible:**
the Speech API account returns 402 "Insufficient Balance" (see fix-voice-and-chunks.md), so
`pnpm latency:report` has no new data. Compare once the account is topped up (protocol at the end).

| #   | Change                                                                                          | Before -> after (what was measured)                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inline always: pieces of at most 65 chars (cut at `, ; : ،` and danda), packet cap 12 -> 14 KiB | worst-case Bangla piece (13.4 KB/120 chars measured in the field): packet 13 671 B (> 12 288, so fetched by URL, 506-605 ms) -> 7 511 B (< 14 336, inline, 5-9 ms). LiveKit reliable data limit 15 KiB (LiveKit docs; not re-fetched here, the installed client does not state it). |
| 2   | STT overlaps the context/payer lookup for an already admitted speaker                           | order test: `context:start, stt` with the context still pending (saves up to the 216 ms context lookup). First utterance and any speaker whose last attempt was refused stay sequential.                                                                                            |
| 3   | First-clause TTS (first piece at the first clause mark once 25 chars exist)                     | test sentence: first piece ready after 68 streamed chars -> 35 chars. Ducking test: one lowered span from first clip start to last clip end.                                                                                                                                        |
| 4   | JWT verified locally (`getClaims`, cached JWKS) on translate, chunk, tts, stream                | Auth-server round trips per utterance 1 -> 0 (test). The project signs with ES256 (JWKS lists one EC key), so local verification applies. Intake ms not measured live.                                                                                                              |
| 5   | `DELIVERY=sse`                                                                                  | listener beacons are tagged `[livekit]`/`[sse]`; `latency:report` prints both. Not measured live.                                                                                                                                                                                   |
| 6   | Report tags                                                                                     | `latency:report` prints speech end -> answer per upload mode and `VAD_END_SILENCE_MS`. Clipped-word rate needs recorded speech: not measured.                                                                                                                                       |
| 7   | Refusal reasons                                                                                 | see "Item 7"                                                                                                                                                                                                                                                                        |
| 8   | Trial notice                                                                                    | see "Item 8"                                                                                                                                                                                                                                                                        |

## Item 7 evidence (guest speech not translated)

- `meeting_participants` for all 7 guest joins on record (5 today): **payer = the sponsor**, and a valid
  sponsored connection existed at join time. `resolve_payer` is correct, so there is no payer fix.
- App log, sessions ad79f9fa and ef1fbe2d (both directions): `translate_decision = translate`,
  `outcome = speech`, and 38 `clip_trace` lines (created and sent ok) for bn-BD and en-US listeners.
  The server did translate and send the guest's speech in those sessions.
- Session 6c1c32b2 (latest): both joined, **status never left `ready`** (`started_at` null, ended
  `abandoned`). The host never pressed Start, so the speaker side stays off (the VAD only listens in
  `live`) and nobody is translated either way. No `translate_decision` line exists for it.
- Not reproducible from the logs: a refusal for a guest. The speaker now sees the exact reason.

## Item 8 evidence (new signup without 15 minutes)

- d28afdaf: email confirmed, profile and billing account exist (so `ensure_user_account` ran), but its
  normalized address is already in `private.trial_grants`, granted to an account that no longer exists
  (the table is kept after deletion on purpose). `grant_trial` correctly returned false.
- 5ee4ee53: never confirmed its email, so the trial waits for confirmation.
- `public.trial_status()` (new migration, read-only) reports `granted / unconfirmed / already_used /
pending`; the dashboard shows the matching sentence. Nothing grants minutes in code.

## Deploy

1. Apply `supabase/migrations/20261101000100_trial_status.sql` (read-only function; the dashboard works
   without it, it just shows no sentence).
2. Optional env: `DELIVERY=sse` (single container only), `PIPELINE_OVERLAP=false` to turn item 2 off.
3. nginx needs nothing for `/api/stream` (the response sends `X-Accel-Buffering: no`), keep
   `proxy_read_timeout` above 15 s.

## Comparison protocol (after the account has credit)

Fixed set: `tests/fixtures/latency-sentences.ts`. Read the 10 sentences twice per setting, then
`pnpm latency:report` and compare p50/p95 of "speech end -> audio start [livekit|sse]", "clip fetch

- decode [inline|url]" and "speech end -> answer, upload whole|chunked, end silence 400|300 ms".
  Clipped words: compare the captions with the sentence text, count the missing words per setting.
