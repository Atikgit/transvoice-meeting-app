import { describe, expect, it } from 'vitest'
import { DUCK_VOLUME } from '@/features/translation/playback'
import { CLIP_GAIN, clipStats } from '@/features/translation/web-audio'

describe('translated clip volume', () => {
  it('is never scaled: gain 1.0 whatever the original-audio mode', () => {
    expect(CLIP_GAIN).toBe(1)
    // The modes (off 1, duck 0.15, mute 0) are applied to the speaker's ORIGINAL LiveKit track
    // only (setOriginalVolume); the clip's GainNode does not read them.
    expect(DUCK_VOLUME).toEqual({ off: 1, duck: 0.15, mute: 0 })
  })

  it('measures length, format, peak and rms of a decoded clip', () => {
    const data = Float32Array.from([0, 0.5, -0.25, 0])
    const buffer = {
      duration: 4 / 16000,
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: () => data,
    } as unknown as AudioBuffer
    const stats = clipStats(buffer)
    expect(stats).toMatchObject({ sampleRate: 16000, channels: 1, peak: 0.5 })
    expect(stats.rms).toBeCloseTo(Math.sqrt((0.25 + 0.0625) / 4), 5)
    const silent = {
      ...buffer,
      getChannelData: () => new Float32Array(100),
    } as unknown as AudioBuffer
    expect(clipStats(silent).peak).toBe(0)
  })
})
