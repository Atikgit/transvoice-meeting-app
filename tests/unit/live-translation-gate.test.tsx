// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lk = {
  micEnabled: true,
  remotes: [{ identity: 'guest' }] as { identity: string }[],
}
vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    localParticipant: {
      getTrackPublication: () => ({
        track: {
          mediaStreamTrack: {
            readyState: 'live',
            addEventListener: () => {},
            removeEventListener: () => {},
          },
        },
      }),
    },
    isMicrophoneEnabled: lk.micEnabled,
  }),
  useRemoteParticipants: () => lk.remotes,
}))
const detector = vi.fn((_args: { listening: boolean }) => ({ speaking: false, error: null }))
vi.mock('@/features/translation/useSpeechDetector', () => ({
  useSpeechDetector: (args: { listening: boolean }) => detector(args),
}))

const { useLiveTranslation } = await import('@/features/translation/useLiveTranslation')

const listening = (
  over: Partial<Parameters<typeof useLiveTranslation>[0]> = {},
): boolean | undefined => {
  detector.mockClear()
  renderHook(() =>
    useLiveTranslation({ sessionId: 's', status: 'live', playingTranslation: false, ...over }),
  )
  return detector.mock.calls.at(-1)?.[0].listening
}

beforeEach(() => {
  lk.micEnabled = true
  lk.remotes = [{ identity: 'guest' }]
})

describe('when the microphone is analysed (VAD gate)', () => {
  it('listens only when the session is live, someone else is CONNECTED (LiveKit remotes), and the mic is on', () => {
    expect(listening()).toBe(true)
  })
  it('not while alone in the room: the count comes from LiveKit remote participants', () => {
    lk.remotes = []
    expect(listening()).toBe(false)
    lk.remotes = [{ identity: 'a' }, { identity: 'b' }]
    expect(listening()).toBe(true)
  })
  it('not while the session is ready or ended', () => {
    expect(listening({ status: 'ready' })).toBe(false)
    expect(listening({ status: 'ended' })).toBe(false)
  })
  it('not with the microphone muted, while a translation plays, or when translation is off', () => {
    lk.micEnabled = false
    expect(listening()).toBe(false)
    lk.micEnabled = true
    expect(listening({ playingTranslation: true })).toBe(false)
    expect(listening({ enabled: false })).toBe(false)
  })
})
