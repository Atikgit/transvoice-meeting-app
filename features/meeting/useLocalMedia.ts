'use client'

import { useEffect, useState } from 'react'

/** Captures camera + mic (falls back to audio only) and toggles tracks on/off. */
export function useLocalMedia({ camera, mic }: { camera: boolean; mic: boolean }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    let activeStream: MediaStream | null = null
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((s) => {
        activeStream = s
        setLocalStream(s)
      })
      .catch((err) => {
        console.log('Video error, trying audio only:', err)
        navigator.mediaDevices
          ?.getUserMedia({ audio: true })
          .then((as) => {
            activeStream = as
            setLocalStream(as)
          })
          .catch((e) => console.log('Audio error:', e))
      })

    return () => {
      activeStream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    localStream?.getVideoTracks().forEach((t) => {
      t.enabled = camera
    })
  }, [camera, localStream])

  useEffect(() => {
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = mic
    })
  }, [mic, localStream])

  return localStream
}
