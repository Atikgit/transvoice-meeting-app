'use client'

import { useState } from 'react'
import { useLocalParticipant, useRemoteParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { encodeWav } from '@/lib/translation/wav'
import { useSpeechDetector, type Utterance } from './useSpeechDetector'
import { shouldListen } from './vad-gate'

export type TranslationNotice = { tone: 'info' | 'error'; text: string } | null

/** Uploads one utterance (POST /api/translate, multipart). */
export async function uploadUtterance({
  sessionId,
  utteranceId,
  utterance,
}: {
  sessionId: string
  utteranceId: string
  utterance: Utterance
}): Promise<Response> {
  const form = new FormData()
  form.set('audio', new Blob([encodeWav(utterance.samples)], { type: 'audio/wav' }), 'utterance.wav')
  form.set('sessionId', sessionId)
  form.set('utteranceId', utteranceId)
  form.set('clientTs', String(Date.now()))
  return fetch('/api/translate', { method: 'POST', body: form })
}

/**
 * Live translation for the local participant: VAD on the LiveKit microphone, gated by
 * shouldListen(), each utterance uploaded as 16 kHz mono WAV.
 */
export function useLiveTranslation({
  sessionId,
  status,
  playingTranslation = false,
}: {
  sessionId: string
  status: 'ready' | 'live' | 'ended'
  playingTranslation?: boolean
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const remotes = useRemoteParticipants()
  const [notice, setNotice] = useState<TranslationNotice>(null)
  const [pending, setPending] = useState(0)

  const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    ?.mediaStreamTrack
  const listening = shouldListen({
    status,
    connectedParticipants: remotes.length + 1,
    micEnabled: isMicrophoneEnabled,
    playingTranslation,
  })

  const detector = useSpeechDetector({
    track: micTrack,
    listening,
    onUtterance: (utterance) => {
      const utteranceId = crypto.randomUUID()
      setPending((n) => n + 1)
      void uploadUtterance({ sessionId, utteranceId, utterance })
        .then(async (res) => {
          if (res.ok) return setNotice(null)
          if (res.status === 429) setNotice({ tone: 'info', text: 'Speaking fast: some phrases were skipped.' })
          else if (res.status >= 500) setNotice({ tone: 'error', text: 'Translation is temporarily unavailable.' })
        })
        .catch(() => setNotice({ tone: 'error', text: 'Network problem: translation paused.' }))
        .finally(() => setPending((n) => n - 1))
    },
  })

  return {
    listening,
    speaking: detector.speaking,
    translating: pending > 0,
    notice: detector.error ? { tone: 'error' as const, text: detector.error } : notice,
  }
}
