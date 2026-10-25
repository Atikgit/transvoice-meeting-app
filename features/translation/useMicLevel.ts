'use client'

import { useEffect, useState } from 'react'
import { sharedAudioContext } from './web-audio'

/**
 * Live microphone level in dBFS (about -90 = silence, -20 = loud speech) for the debug overlay:
 * shows whether the browser delivers any sound to the VAD at all. Reads the same track the VAD
 * listens to through an AnalyserNode; nothing is recorded.
 */
export function useMicLevel(track: MediaStreamTrack | undefined, active: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)

  useEffect(() => {
    const ctx = sharedAudioContext()
    if (!active || !track || !ctx) return
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser) // not connected to the speakers
    const samples = new Float32Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      const rms = Math.sqrt(sum / samples.length)
      setLevel(rms > 0 ? Math.max(-90, Math.round(20 * Math.log10(rms))) : -90)
    }, 250)
    return () => {
      clearInterval(timer)
      source.disconnect()
      analyser.disconnect()
    }
  }, [track, active])

  return active && track ? level : null
}
