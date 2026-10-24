'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { MicVAD } from '@ricky0123/vad-web'
import { VAD_ASSET_PATH, VAD_SETTINGS } from './vad-gate'

export interface Utterance {
  /** 16 kHz mono samples in [-1, 1]. */
  samples: Float32Array
  /** performance.now() when the speaker stopped (latency metrics). */
  endedAt: number
}

/**
 * Voice activity detection on the LiveKit microphone track (@ricky0123/vad-web, Silero v5,
 * assets from /vad). `listening` comes from shouldListen(); when it turns false mid-utterance
 * the audio is dropped. Utterances longer than 12 s are cut and sent in pieces.
 * The LiveKit track is never stopped by the VAD (pause/resume are no-ops on the stream).
 */
export function useSpeechDetector({
  track,
  listening,
  onUtterance,
}: {
  track: MediaStreamTrack | undefined
  listening: boolean
  onUtterance: (utterance: Utterance) => void
}) {
  const vadRef = useRef<MicVAD | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const emit = useEffectEvent(onUtterance)

  // Create the VAD for this microphone track.
  useEffect(() => {
    if (!track) return
    let cancelled = false
    let splitTimer: ReturnType<typeof setTimeout> | undefined
    const stream = new MediaStream([track])

    void (async () => {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web')
        const vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: VAD_ASSET_PATH,
          onnxWASMBasePath: VAD_ASSET_PATH,
          startOnLoad: false,
          submitUserSpeechOnPause: false,
          redemptionMs: VAD_SETTINGS.redemptionMs,
          minSpeechMs: VAD_SETTINGS.minSpeechMs,
          preSpeechPadMs: VAD_SETTINGS.preSpeechPadMs,
          positiveSpeechThreshold: VAD_SETTINGS.positiveSpeechThreshold,
          negativeSpeechThreshold: VAD_SETTINGS.negativeSpeechThreshold,
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async () => stream,
          onSpeechStart: () => {
            setSpeaking(true)
            // Force a cut at the maximum utterance length, then keep listening.
            clearTimeout(splitTimer)
            splitTimer = setTimeout(async () => {
              const current = vadRef.current
              if (!current) return
              current.setOptions({ submitUserSpeechOnPause: true })
              await current.pause()
              current.setOptions({ submitUserSpeechOnPause: false })
              await current.start()
            }, VAD_SETTINGS.maxUtteranceMs)
          },
          onSpeechEnd: (samples) => {
            clearTimeout(splitTimer)
            setSpeaking(false)
            emit({ samples, endedAt: performance.now() })
          },
          onVADMisfire: () => {
            clearTimeout(splitTimer)
            setSpeaking(false)
          },
        })
        if (cancelled) return void vad.destroy()
        vadRef.current = vad
        setError(null)
      } catch (e) {
        console.error('Voice activity detection failed to start:', e)
        setError('Live translation is unavailable in this browser.')
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(splitTimer)
      void vadRef.current?.destroy()
      vadRef.current = null
    }
  }, [track])

  // Start / pause with the gate (pausing drops any partial utterance).
  useEffect(() => {
    const vad = vadRef.current
    if (!vad) return
    if (listening) void vad.start()
    else void vad.pause()
  }, [listening, track, error])

  // A paused VAD drops the partial utterance without an end event.
  return { error, speaking: speaking && listening }
}
