// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = new Map<string, () => void>()
const room = {
  canPlaybackAudio: false,
  startAudio: vi.fn(async () => {
    room.canPlaybackAudio = true
  }),
  on: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)),
  off: vi.fn(),
}
let running = false
const unlockAudio = vi.fn(async () => {
  running = true
  return true
})
vi.mock('@livekit/components-react', () => ({ useRoomContext: () => room }))
vi.mock('livekit-client', () => ({
  RoomEvent: { AudioPlaybackStatusChanged: 'audioPlaybackChanged' },
}))
vi.mock('@/features/translation/web-audio', () => ({
  audioIsRunning: () => running,
  onAudioStateChange: () => () => {},
  unlockAudio,
  unlockAudioOnFirstGesture: () => () => {},
}))

const { useAudioPlayback } = await import('@/features/meeting/useAudioPlayback')

beforeEach(() => {
  vi.clearAllMocks()
  room.canPlaybackAudio = false
  running = false
})

describe('useAudioPlayback', () => {
  it('is blocked until a tap resumes the AudioContext and starts LiveKit audio', async () => {
    const { result } = renderHook(() => useAudioPlayback())
    expect(result.current.blocked).toBe(true)
    await act(async () => result.current.enable())
    expect(unlockAudio).toHaveBeenCalled()
    expect(room.startAudio).toHaveBeenCalled()
    expect(result.current.blocked).toBe(false)
  })

  it('follows LiveKit when the browser blocks playback again', async () => {
    room.canPlaybackAudio = true
    running = true
    const { result } = renderHook(() => useAudioPlayback())
    expect(result.current.blocked).toBe(false)
    room.canPlaybackAudio = false
    act(() => listeners.get('audioPlaybackChanged')?.())
    expect(result.current.blocked).toBe(true)
  })
})
