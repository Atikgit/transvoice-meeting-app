'use client'

import { useEffect } from 'react'
import { reportDiag } from './diag'

/**
 * Watches the microphone track that is published to LiveKit. If anything (a second capture, the
 * browser, the OS, a device switch) mutes or ends it, the other person stops hearing the original
 * voice and the VAD stops hearing speech: that must never be silent. Logs a warning in the
 * console and one line in the server log (POST /api/diag).
 */
export function useLocalAudioWatch(track: MediaStreamTrack | undefined, sessionId: string) {
  useEffect(() => {
    if (!track) return
    const onMute = () => {
      console.warn('Local microphone track was muted by the browser or the system')
      reportDiag({ type: 'local_audio_muted', sessionId })
    }
    const onUnmute = () => reportDiag({ type: 'local_audio_unmuted', sessionId })
    const onEnded = () => {
      console.warn('Local microphone track ended')
      reportDiag({ type: 'local_audio_ended', sessionId })
    }
    track.addEventListener('mute', onMute)
    track.addEventListener('unmute', onUnmute)
    track.addEventListener('ended', onEnded)
    if (track.readyState === 'ended') onEnded()
    return () => {
      track.removeEventListener('mute', onMute)
      track.removeEventListener('unmute', onUnmute)
      track.removeEventListener('ended', onEnded)
    }
  }, [track, sessionId])
}
