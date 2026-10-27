'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { MicVAD } from '@ricky0123/vad-web'
import { clampEndSilence, VAD_ASSET_PATH, VAD_SETTINGS } from './vad-gate'
import { setTranslationDebug } from './debug-store'
import { sharedAudioContext } from './web-audio'
import { UtteranceChunker } from './utterance-chunker'

/** Destroys a VAD without throwing (its start-up may still be in flight). */
async function retire(vad: MicVAD): Promise<void> {
  try {
    await vad.destroy()
  } catch (e) {
    console.warn('Voice activity detector cleanup:', e instanceof Error ? e.message : e)
  }
}

export interface Utterance {
  /** 16 kHz mono samples in [-1, 1]. */
  samples: Float32Array
  /** performance.now() when the speaker actually stopped talking (before the VAD's silence wait). */
  endedAt: number
  /** Piece of a long speech: all pieces share `group`; `seq` counts from 0. Absent for a single utterance. */
  chunk?: { group: string; seq: number }
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
  endSilenceMs,
  maxChunkMs,
}: {
  track: MediaStreamTrack | undefined
  listening: boolean
  /** Silence that ends an utterance (VAD_END_SILENCE_MS, 300–700; default 400). */
  endSilenceMs?: number
  /** VAD_MAX_CHUNK_MS: a longer speech is cut at its latest pause of >= 250 ms and sent in pieces. */
  maxChunkMs?: number
  onUtterance: (utterance: Utterance) => void
}) {
  const vadRef = useRef<MicVAD | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [ready, setReady] = useState(false)
  const emit = useEffectEvent(onUtterance)
  const redemptionMs = clampEndSilence(endSilenceMs)

  // Create the VAD for this microphone track.
  useEffect(() => {
    if (!track) return
    let cancelled = false
    let splitTimer: ReturnType<typeof setTimeout> | undefined
    // The VAD listens to a CLONE of the published microphone track: same capture (no second
    // getUserMedia), but stopping or disabling the VAD's copy can never end or mute the track
    // that LiveKit sends to the other person. The clone is always enabled; the gate
    // (shouldListen) decides when the VAD may listen, e.g. never while the user is muted.
    const capture = track.clone()
    capture.enabled = true
    const stream = new MediaStream([capture])
    const chunker = new UtteranceChunker(maxChunkMs ?? VAD_SETTINGS.maxChunkMs)
    // One id per long speech: its pieces are sent in order and share it.
    let group: string | null = null
    const emitPiece = (samples: Float32Array, seq: number, endedAgoMs: number) => {
      group ??= crypto.randomUUID()
      emit({ samples, endedAt: performance.now() - endedAgoMs, chunk: { group, seq } })
    }
    setTranslationDebug({ vad: 'loading', vadError: undefined })

    void (async () => {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web')
        const vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: VAD_ASSET_PATH,
          onnxWASMBasePath: VAD_ASSET_PATH,
          // The shared context unlocked by a user gesture (iOS/Safari keep a private one suspended).
          audioContext: sharedAudioContext() ?? undefined,
          startOnLoad: false,
          submitUserSpeechOnPause: false,
          redemptionMs,
          minSpeechMs: VAD_SETTINGS.minSpeechMs,
          preSpeechPadMs: VAD_SETTINGS.preSpeechPadMs,
          positiveSpeechThreshold: VAD_SETTINGS.positiveSpeechThreshold,
          negativeSpeechThreshold: VAD_SETTINGS.negativeSpeechThreshold,
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async () => stream,
          onFrameProcessed: (probabilities, frame) => {
            const piece = chunker.frame(probabilities.isSpeech, frame)
            if (piece) emitPiece(piece.samples, piece.seq, piece.endedAgoMs)
          },
          onSpeechStart: () => {
            chunker.speechStart()
            group = null
            setSpeaking(true)
            setTranslationDebug({ vadSpeaking: true })
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
            setTranslationDebug({ vadSpeaking: false })
            // The VAD only fires after `redemptionMs` of silence: speech really ended that long ago.
            const rest = chunker.speechEnd()
            if (rest === 'whole') emit({ samples, endedAt: performance.now() - redemptionMs })
            else if (rest) emitPiece(rest.samples, rest.seq, redemptionMs)
            group = null
          },
          onVADMisfire: () => {
            chunker.reset()
            clearTimeout(splitTimer)
            setSpeaking(false)
            setTranslationDebug({ vadSpeaking: false })
          },
        })
        // Build the audio graph now (model + worklet preloaded before the meeting starts) and
        // pause: MicVAD.destroy() and pause() throw on a VAD that was never started.
        await vad.start()
        await vad.pause()
        if (cancelled) return void retire(vad)
        vadRef.current = vad
        setReady(true)
        setError(null)
        setTranslationDebug({ vad: 'ready' })
      } catch (e) {
        console.error('Voice activity detection failed to start:', e)
        setError('Live translation is unavailable in this browser.')
        setTranslationDebug({ vad: 'error', vadError: e instanceof Error ? e.message : String(e) })
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(splitTimer)
      if (vadRef.current) void retire(vadRef.current)
      capture.stop() // the clone only
      vadRef.current = null
      setReady(false)
      setTranslationDebug({ vad: 'off', vadListening: false, vadSpeaking: false })
    }
  }, [track, redemptionMs, maxChunkMs])

  // Start / pause with the gate (pausing drops any partial utterance). MicVAD throws on pause()
  // before its first start(), and start() must wait until the model has loaded.
  useEffect(() => {
    const vad = vadRef.current
    if (!vad || !ready) return
    if (listening) {
      void vad
        .start()
        .then(() => setTranslationDebug({ vadListening: true }))
        .catch((e: unknown) => {
          console.error('Voice activity detection could not start:', e)
          setError('Live translation is unavailable in this browser.')
        })
    } else if (vad.listening) {
      void vad
        .pause()
        .then(() => setTranslationDebug({ vadListening: false }))
        .catch(() => {})
    }
  }, [listening, ready])

  // A paused VAD drops the partial utterance without an end event.
  return { error, ready, speaking: speaking && listening }
}
