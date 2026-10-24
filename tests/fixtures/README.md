# Test fixtures

- `tone-3s.wav` — synthetic 440 Hz tone, 16 kHz mono (generated with ffmpeg). Used to prove the
  voice activity detector starts and ignores non-speech.
- `bangla-utterance.wav` — **not in the repo, you provide it.** A 3–6 s recording of a person
  saying a Bangla sentence, with ~1 s of silence before and after, 16 kHz mono 16-bit PCM:

  ```sh
  ffmpeg -i recording.m4a -ar 16000 -ac 1 -c:a pcm_s16le tests/fixtures/bangla-utterance.wav
  ```

  Chromium loops it as the fake microphone (`--use-file-for-fake-audio-capture`). The speech
  tests in `tests/e2e/vad.spec.ts` and `tests/e2e/translation-two-party.spec.ts` skip without it.
  Use a recording you own or have the right to use.
