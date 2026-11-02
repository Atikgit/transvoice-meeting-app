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
