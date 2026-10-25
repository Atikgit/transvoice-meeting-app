import { describe, expect, it } from 'vitest'
import { clampEndSilence, shouldListen, VAD_SETTINGS } from '@/features/translation/vad-gate'

const live = {
  status: 'live' as const,
  connectedParticipants: 2,
  micEnabled: true,
  playingTranslation: false,
}

describe('shouldListen (VAD gate)', () => {
  it('listens only when live, with 2+ connected and the mic on', () => {
    expect(shouldListen(live)).toBe(true)
    expect(shouldListen({ ...live, status: 'ready' })).toBe(false)
    expect(shouldListen({ ...live, status: 'ended' })).toBe(false)
    expect(shouldListen({ ...live, connectedParticipants: 1 })).toBe(false)
    expect(shouldListen({ ...live, micEnabled: false })).toBe(false)
  })

  it('echo safety: never listens while a translated clip plays locally', () => {
    expect(shouldListen({ ...live, playingTranslation: true })).toBe(false)
    expect(shouldListen({ ...live, connectedParticipants: 5, playingTranslation: true })).toBe(
      false,
    )
  })

  it('the end-of-speech pause is configurable between 300 and 700 ms', () => {
    expect(clampEndSilence(undefined)).toBe(400)
    expect(clampEndSilence(350)).toBe(350)
    expect(clampEndSilence(100)).toBe(300)
    expect(clampEndSilence(5000)).toBe(700)
    expect(clampEndSilence(Number.NaN)).toBe(400)
  })

  it('uses the §8 timings', () => {
    expect(VAD_SETTINGS).toMatchObject({
      redemptionMs: 400,
      minSpeechMs: 300,
      maxUtteranceMs: 12_000,
    })
  })
})
