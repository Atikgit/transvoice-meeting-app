'use client'

import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track, type RemoteAudioTrack } from 'livekit-client'
import { parseDataMessage, TOPICS } from '@/lib/translation/messages'
import { addCaption, type CaptionEntry } from './captions'
import { LatencyTracker, type LatencySample } from './metrics'
import { PlaybackQueues, type Clip, type OriginalAudioMode } from './playback'
import { fetchAndDecode, playBuffer, unlockAudioOnFirstGesture } from './web-audio'

/**
 * Receives the server's captions and translated clips (LiveKit data, topics tvx.*) and plays
 * them: per-speaker queue, stale clips dropped, original audio ducked while a clip plays.
 */
export function useTranslatedAudio({
  originalAudioMode,
}: {
  originalAudioMode: OriginalAudioMode
}) {
  const room = useRoomContext()
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [playing, setPlaying] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [latency, setLatency] = useState<LatencySample | null>(null)
  const modeRef = useRef(originalAudioMode)
  const tracker = useRef(new LatencyTracker())
  const speechEnds = useRef(new Map<string, number>())

  useEffect(() => {
    modeRef.current = originalAudioMode
  }, [originalAudioMode])

  useEffect(() => {
    const queues = new PlaybackQueues<AudioBuffer>({
      now: () => performance.now(),
      prepare: (clip) => fetchAndDecode(clip.url),
      play: (buffer) => playBuffer(buffer),
      mode: () => modeRef.current,
      setOriginalVolume: (speakerId, volume) => {
        const track = room.remoteParticipants
          .get(speakerId)
          ?.getTrackPublication(Track.Source.Microphone)?.track as RemoteAudioTrack | undefined
        track?.setVolume(volume)
      },
      onPlayingChange: setPlaying,
      onStart: (clip) => {
        const endedAt = speechEnds.current.get(clip.utteranceId)
        if (endedAt !== undefined) {
          tracker.current.audioStarted(clip.utteranceId, endedAt, Date.now())
          setLatency(tracker.current.latest())
        }
      },
    })

    const onData = (payload: Uint8Array, participant: unknown, _kind: unknown, topic?: string) => {
      // Only the server sends tvx.* messages (clients cannot publish data): ignore the rest.
      if (participant) return
      const parsed = parseDataMessage(topic, payload)
      if (!parsed) return
      if (parsed.topic === TOPICS.caption) {
        const m = parsed.message
        speechEnds.current.set(m.utteranceId, m.speechEndedAt)
        tracker.current.captionShown(m.utteranceId, m.speechEndedAt, Date.now())
        setLatency(tracker.current.latest())
        setUnavailable(false)
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
        const clip: Clip = {
          speakerId: m.speakerId,
          utteranceId: m.utteranceId,
          url: m.url,
          receivedAt: performance.now(),
        }
        queues.enqueue(clip)
      } else if (parsed.topic === TOPICS.notice) {
        setUnavailable(parsed.message.kind === 'translation_unavailable')
      }
    }

    room.on(RoomEvent.DataReceived, onData)
    const stopGestureUnlock = unlockAudioOnFirstGesture()
    return () => {
      room.off(RoomEvent.DataReceived, onData)
      stopGestureUnlock()
      queues.clear()
    }
  }, [room])

  /** My own transcript, shown to me as the speaker. */
  const addOwnTranscript = (id: string, original: string) =>
    setCaptions((log) => addCaption(log, { id, from: 'self', original, translated: '' }))

  return { captions, playing, unavailable, latency, addOwnTranscript }
}
