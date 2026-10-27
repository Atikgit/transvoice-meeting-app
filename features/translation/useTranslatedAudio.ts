'use client'

import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track, type RemoteAudioTrack } from 'livekit-client'
import { decodeInlineAudio, parseDataMessage, TOPICS } from '@/lib/translation/messages'
import { addCaption, type CaptionEntry } from './captions'
import { getTranslationDebug as getDebug, rememberClip, setTranslationDebug } from './debug-store'
import { reportLatency } from './latency-beacon'
import { LatencyTracker, type LatencySample } from './metrics'
import { PlaybackQueues, type Clip, type OriginalAudioMode } from './playback'
import {
  audioContextState,
  audioIsRunning,
  CLIP_GAIN,
  clipStats,
  decodeBytes,
  fetchAndDecode,
  onAudioStateChange,
  playBuffer,
  unlockAudioOnFirstGesture,
} from './web-audio'
import { reportDiag } from './diag'

/**
 * Receives the server's captions and translated clips (LiveKit data, topics tvx.*) and plays
 * them: per-speaker queue, stale clips dropped, original audio ducked while a clip plays.
 */
export function useTranslatedAudio({
  sessionId,
  originalAudioMode,
}: {
  sessionId: string
  originalAudioMode: OriginalAudioMode
}) {
  const room = useRoomContext()
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [playing, setPlaying] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  /** Last utterance came as a caption only (its voice clip was empty). */
  const [audioMissing, setAudioMissing] = useState(false)
  const [latency, setLatency] = useState<LatencySample | null>(null)
  const modeRef = useRef(originalAudioMode)
  const tracker = useRef(new LatencyTracker())
  const speechEnds = useRef(new Map<string, number>())
  // Per utterance: the caption's language and how long fetching + decoding its clip took.
  const clipInfo = useRef(
    new Map<string, { lang?: string; fetchMs?: number; via?: 'url' | 'inline' }>(),
  )

  useEffect(() => {
    modeRef.current = originalAudioMode
  }, [originalAudioMode])

  useEffect(() => {
    const queues = new PlaybackQueues<AudioBuffer>({
      now: () => performance.now(),
      prepare: async (clip) => {
        const started = performance.now()
        try {
          const via = clip.data ? 'inline' : 'url'
          const buffer = clip.data ? await decodeBytes(clip.data) : await fetchAndDecode(clip.url)
          clipInfo.current.set(clip.utteranceId, {
            ...clipInfo.current.get(clip.utteranceId),
            fetchMs: Math.round(performance.now() - started),
            via,
          })
          setTranslationDebug({
            lastAudio: {
              via,
              status: 'ok',
              ms: Math.round(performance.now() - started),
              at: Date.now(),
            },
          })
          const stats = clipStats(buffer)
          rememberClip(buffer)
          setTranslationDebug({ lastClip: { ...stats, at: Date.now() } })
          // An undecodable-as-sound clip (empty / inaudible) is invisible to the listener but
          // not to the log: this is how a "silent translation" shows up in production.
          if (stats.peak < 0.01 || stats.seconds < 0.2)
            reportDiag({
              type: 'clip_quiet',
              detail: `peak ${stats.peak.toFixed(3)} dur ${stats.seconds.toFixed(2)} rate ${stats.sampleRate}`,
              sessionId,
            })
          return buffer
        } catch (error) {
          const status = /responded (\d+)/.exec(String((error as Error)?.message))?.[1]
          setTranslationDebug({
            lastAudio: {
              via: 'url',
              status: status ? Number(status) : 'error',
              ms: Math.round(performance.now() - started),
              at: Date.now(),
            },
          })
          throw error
        }
      },
      play: (buffer) => playBuffer(buffer),
      durationMs: (buffer) => buffer.duration * 1000,
      // A suspended audio context plays nothing: do not lower the voice that IS coming through.
      canPlay: () => audioIsRunning(),
      mode: () => modeRef.current,
      setOriginalVolume: (speakerId, volume) => {
        const track = room.remoteParticipants
          .get(speakerId)
          ?.getTrackPublication(Track.Source.Microphone)?.track as RemoteAudioTrack | undefined
        track?.setVolume(volume)
      },
      onPlayingChange: (value) => {
        setPlaying(value)
        setTranslationDebug({ queue: queues.size() })
      },
      onDuck: (event) => {
        setTranslationDebug({ lastDuck: { ...event, at: Date.now() } })
        const current = getDebug().lastClip
        if (current)
          setTranslationDebug({
            lastClip: {
              ...current,
              ...(event.reason === 'start'
                ? {
                    gain: CLIP_GAIN,
                    ctxAtStart: audioContextState(),
                    originalAtStart: event.volume,
                  }
                : { originalAtEnd: event.volume }),
            },
          })
        // A clip that hung or failed while the original was lowered is worth a line in the log.
        if (event.reason === 'timeout' || event.reason === 'failed') {
          reportDiag({ type: 'duck_restored', detail: event.reason, sessionId })
        }
      },
      onDrop: (clip, reason) => {
        if (reason === 'blocked') {
          reportDiag({
            type: 'audio_blocked',
            detail: 'clip dropped, audio context not running',
            sessionId,
          })
        }
        void clip
      },
      onStart: (clip) => {
        const endedAt = speechEnds.current.get(clip.utteranceId)
        if (endedAt !== undefined) {
          tracker.current.audioStarted(clip.utteranceId, endedAt, Date.now())
          setLatency(tracker.current.latest())
          const sample = tracker.current.get(clip.utteranceId)
          const info = clipInfo.current.get(clip.utteranceId)
          reportLatency({
            sessionId,
            utteranceId: clip.utteranceId,
            kind: 'listen',
            lang: info?.lang,
            captionMs: sample?.captionMs,
            audioMs: sample?.audioMs,
            fetchMs: info?.fetchMs,
            via: info?.via ?? 'url',
          })
          clipInfo.current.delete(clip.utteranceId)
        }
      },
    })

    const onData = (payload: Uint8Array, participant: unknown, _kind: unknown, topic?: string) => {
      // Only the server sends tvx.* messages (clients cannot publish data): ignore the rest.
      if (participant) return
      if (topic === TOPICS.audioInline) {
        const inline = decodeInlineAudio(payload)
        if (!inline) return
        const { header, audio } = inline
        speechEnds.current.set(header.utteranceId, header.speechEndedAt)
        clipInfo.current.set(header.utteranceId, {
          ...clipInfo.current.get(header.utteranceId),
          lang: header.lang,
        })
        queues.enqueue({
          speakerId: header.speakerId,
          utteranceId: header.utteranceId,
          url: '',
          data: audio,
          receivedAt: performance.now(),
        })
        setTranslationDebug({ queue: queues.size() })
        return
      }
      const parsed = parseDataMessage(topic, payload)
      if (!parsed) return
      if (parsed.topic === TOPICS.caption) {
        const m = parsed.message
        speechEnds.current.set(m.utteranceId, m.speechEndedAt)
        clipInfo.current.set(m.utteranceId, {
          ...clipInfo.current.get(m.utteranceId),
          lang: m.lang,
        })
        if (clipInfo.current.size > 50)
          clipInfo.current.delete(clipInfo.current.keys().next().value!)
        setTranslationDebug({ lastCaption: { lang: m.lang, at: Date.now() } })
        tracker.current.captionShown(m.utteranceId, m.speechEndedAt, Date.now())
        setLatency(tracker.current.latest())
        setUnavailable(false)
        setAudioMissing(false)
        setCaptions((log) =>
          addCaption(log, {
            id: m.utteranceId,
            from: 'other',
            original: m.original,
            translated: m.translated,
          }),
        )
      } else if (parsed.topic === TOPICS.audio) {
        const m = parsed.message
        speechEnds.current.set(m.utteranceId, m.speechEndedAt)
        // The audio can arrive before its caption (separate packets): remember the language here too.
        clipInfo.current.set(m.utteranceId, {
          ...clipInfo.current.get(m.utteranceId),
          lang: m.lang,
        })
        const clip: Clip = {
          speakerId: m.speakerId,
          utteranceId: m.utteranceId,
          url: m.url,
          receivedAt: performance.now(),
        }
        queues.enqueue(clip)
        setTranslationDebug({ queue: queues.size() })
      } else if (parsed.topic === TOPICS.notice) {
        if (parsed.message.kind === 'audio_unavailable') setAudioMissing(true)
        else setUnavailable(true)
      }
    }

    room.on(RoomEvent.DataReceived, onData)
    const stopGestureUnlock = unlockAudioOnFirstGesture()
    // Backgrounded tab / stopped audio context: whatever was lowered goes back to full volume.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') queues.restoreAll('interrupted')
    }
    const onPageHide = () => queues.restoreAll('interrupted')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    const offContext = onAudioStateChange(() => {
      if (!audioIsRunning()) queues.restoreAll('interrupted')
    })
    return () => {
      room.off(RoomEvent.DataReceived, onData)
      stopGestureUnlock()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      offContext()
      queues.clear()
    }
  }, [room, sessionId])

  /** My own transcript, shown to me as the speaker. */
  const addOwnTranscript = (id: string, original: string) =>
    setCaptions((log) => addCaption(log, { id, from: 'self', original, translated: '' }))

  return { captions, playing, unavailable, audioMissing, latency, addOwnTranscript }
}
