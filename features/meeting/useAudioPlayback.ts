'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import {
  audioIsRunning,
  onAudioStateChange,
  unlockAudio,
  unlockAudioOnFirstGesture,
} from '@/features/translation/web-audio'

/**
 * Mobile autoplay: iOS Safari and Android Chrome keep audio blocked until a user gesture. Tries
 * to unlock on the first tap, and reports `blocked` when LiveKit's remote audio or our
 * translated-clip AudioContext still cannot play, so the room can show "Tap to enable audio".
 * `enable()` must be called from a click / tap handler.
 */
export function useAudioPlayback() {
  const room = useRoomContext()
  const [canPlay, setCanPlay] = useState(room.canPlaybackAudio)
  const [contextRunning, setContextRunning] = useState(audioIsRunning())

  const enable = useCallback(async () => {
    // Both inside the gesture: resume our AudioContext and let LiveKit start its <audio> tags.
    await Promise.allSettled([unlockAudio(), room.startAudio()])
    setCanPlay(room.canPlaybackAudio)
    setContextRunning(audioIsRunning())
  }, [room])

  useEffect(() => {
    const onStatus = () => setCanPlay(room.canPlaybackAudio)
    room.on(RoomEvent.AudioPlaybackStatusChanged, onStatus)
    const offContext = onAudioStateChange(() => setContextRunning(audioIsRunning()))
    const offGesture = unlockAudioOnFirstGesture()
    // Any first interaction (tap, click, key) starts LiveKit's audio too: a guest who joins a room
    // that is already live never presses Start.
    const onGesture = () => void room.startAudio().catch(() => {})
    const gestures = ['pointerdown', 'touchend', 'keydown'] as const
    for (const type of gestures)
      window.addEventListener(type, onGesture, { once: true, passive: true })
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, onStatus)
      offContext()
      offGesture()
      for (const type of gestures) window.removeEventListener(type, onGesture)
    }
  }, [room])

  return { blocked: !canPlay || !contextRunning, enable }
}
