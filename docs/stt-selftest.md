# STT self-test (synthetic speech)

Run 2026-11-02. Speech API /v1/stt, lang en / bn, 16 kHz mono WAV, voices: en-US-AvaNeural + en-US-AndrewNeural; bn-BD-NabanitaNeural + bn-BD-PradeepNeural. Clips were made with /v1/tts. "Dropped" = the answer the app would throw away as silence (empty, one character, or a phantom phrase: you / thank you / i / am i).

| Language | Variant | Clips | Dropped | Rate | empty | single_char | filtered_phantom | error | p50 ms | max ms |
|---|---|---|---|---|---|---|---|---|---|---|
| English | a clean | 20 | 2 | 10% | 0 | 0 | 2 | 0 | 736 | 987 |
| English | b +300 ms silence both sides | 20 | 2 | 10% | 0 | 0 | 2 | 0 | 766 | 896 |
| English | c white noise -35 dBFS rms | 20 | 2 | 10% | 0 | 0 | 2 | 0 | 734 | 866 |
| English | d first 150 ms cut | 20 | 2 | 10% | 0 | 0 | 2 | 0 | 728 | 859 |
| Bangla | a clean | 20 | 0 | 0% | 0 | 0 | 0 | 0 | 1434 | 2220 |
| Bangla | b +300 ms silence both sides | 20 | 0 | 0% | 0 | 0 | 0 | 0 | 1315 | 1906 |
| Bangla | c white noise -35 dBFS rms | 20 | 0 | 0% | 0 | 0 | 0 | 0 | 1248 | 1886 |
| Bangla | d first 150 ms cut | 20 | 0 | 0% | 0 | 0 | 0 | 0 | 1234 | 1860 |

## Dropped clips: what the API returned

| Language | Variant | Voice | Sentence | Seconds | Class | Returned |
|---|---|---|---|---|---|---|
| English | a_clean | en-US-AvaNeural | 2 | 1.87 | filtered_phantom | "Thank you." |
| English | b_padded | en-US-AvaNeural | 2 | 2.47 | filtered_phantom | "Thank you." |
| English | c_noise | en-US-AvaNeural | 2 | 1.87 | filtered_phantom | "Thank you." |
| English | d_clipped | en-US-AvaNeural | 2 | 1.72 | filtered_phantom | "Thank you." |
| English | a_clean | en-US-AndrewNeural | 2 | 0.82 | filtered_phantom | "Thank you." |
| English | b_padded | en-US-AndrewNeural | 2 | 1.42 | filtered_phantom | "Thank you." |
| English | c_noise | en-US-AndrewNeural | 2 | 0.82 | filtered_phantom | "Thank you." |
| English | d_clipped | en-US-AndrewNeural | 2 | 0.67 | filtered_phantom | "Thank you." |

STT calls slower than the app's 4000 ms step limit: 0 of 160.
