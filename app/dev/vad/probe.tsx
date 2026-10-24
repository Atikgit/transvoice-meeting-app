'use client'

import { useEffect, useState } from 'react'
import { useSpeechDetector, type Utterance } from '@/features/translation/useSpeechDetector'
import { encodeWav, isWav } from '@/lib/translation/wav'

/** Fake-microphone VAD probe. */
export function VadProbe() {
  const [track, setTrack] = useState<MediaStreamTrack>()
  const [utterances, setUtterances] = useState<
    { seconds: number; wavBytes: number; valid: boolean }[]
  >([])
  const [micError, setMicError] = useState<string>()

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => setTrack(stream.getAudioTracks()[0]))
      .catch((e: Error) => setMicError(e.message))
  }, [])

  const detector = useSpeechDetector({
    track,
    listening: true,
    onUtterance: ({ samples }: Utterance) => {
      const wav = encodeWav(samples)
      setUtterances((u) => [
        ...u,
        { seconds: samples.length / 16000, wavBytes: wav.length, valid: isWav(wav) },
      ])
    },
  })

  const state = micError
    ? 'mic-error'
    : detector.error
      ? 'error'
      : detector.ready
        ? 'ready'
        : 'loading'
  return (
    <main className="p-6 font-mono text-sm text-slate-200">
      <p data-testid="vad-state">{state}</p>
      <p data-testid="vad-error">{detector.error ?? micError ?? ''}</p>
      <p data-testid="vad-speaking">{String(detector.speaking)}</p>
      <p data-testid="vad-utterances">{utterances.length}</p>
      <pre data-testid="vad-last">{JSON.stringify(utterances.at(-1) ?? null)}</pre>
    </main>
  )
}
