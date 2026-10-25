// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeInlineAudio, encodeMessage, TOPICS } from '@/lib/translation/messages'

type Handler = (payload: Uint8Array, participant: unknown, kind: unknown, topic?: string) => void
const handlers: Handler[] = []
const room = {
  remoteParticipants: new Map(),
  on: (_event: string, handler: Handler) => handlers.push(handler),
  off: vi.fn(),
}
vi.mock('@livekit/components-react', () => ({ useRoomContext: () => room }))
vi.mock('livekit-client', () => ({
  RoomEvent: { DataReceived: 'dataReceived' },
  Track: { Source: { Microphone: 'microphone' } },
}))

const ctx = { running: true, listeners: [] as (() => void)[] }
const decoded = { duration: 1 } as AudioBuffer
const decodeBytes = vi.fn(async () => decoded)
const fetchAndDecode = vi.fn(async () => decoded)
const playBuffer = vi.fn(async () => {})
vi.mock('@/features/translation/web-audio', () => ({
  decodeBytes,
  fetchAndDecode,
  playBuffer,
  audioIsRunning: () => ctx.running,
  onAudioStateChange: (cb: () => void) => {
    ctx.listeners.push(cb)
    return () => {}
  },
  unlockAudioOnFirstGesture: () => () => {},
}))
const reportLatency = vi.fn()
vi.mock('@/features/translation/latency-beacon', () => ({ reportLatency }))
const reportDiag = vi.fn()
vi.mock('@/features/translation/diag', () => ({ reportDiag }))

const { useTranslatedAudio } = await import('@/features/translation/useTranslatedAudio')
const send = (topic: string, payload: Uint8Array) =>
  act(() => handlers.forEach((h) => h(payload, undefined, 0, topic)))

beforeEach(() => {
  handlers.length = 0
  ctx.running = true
  ctx.listeners.length = 0
  room.remoteParticipants.clear()
  vi.clearAllMocks()
})

describe('useTranslatedAudio', () => {
  it('plays an inline clip straight from the packet: no HTTP fetch', async () => {
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'off' }))
    const clip = new Uint8Array([1, 2, 3, 4])
    send(
      TOPICS.audioInline,
      encodeInlineAudio(
        {
          utteranceId: 'u1',
          speakerId: 'speaker',
          lang: 'en-US',
          format: 'mp3',
          speechEndedAt: Date.now() - 900,
        },
        clip,
      ),
    )
    await vi.waitFor(() => expect(playBuffer).toHaveBeenCalledWith(decoded))
    expect(decodeBytes).toHaveBeenCalledWith(clip)
    expect(fetchAndDecode).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(reportLatency).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          utteranceId: 'u1',
          kind: 'listen',
          lang: 'en-US',
          via: 'inline',
        }),
      ),
    )
  })

  it('fetches a URL clip as soon as its message arrives and plays it; ignores junk and client packets', async () => {
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'off' }))
    const audio = {
      utteranceId: 'u2',
      speakerId: 'speaker',
      lang: 'es-ES',
      url: '/api/tts/' + 'a'.repeat(24),
      speechEndedAt: Date.now(),
    }
    send(TOPICS.audioInline, new Uint8Array([9, 9])) // malformed: dropped
    act(() => handlers.forEach((h) => h(encodeMessage(audio), { identity: 'x' }, 0, TOPICS.audio))) // from a client
    expect(fetchAndDecode).not.toHaveBeenCalled()
    send(TOPICS.audio, encodeMessage(audio))
    expect(fetchAndDecode).toHaveBeenCalledWith(audio.url) // synchronously, on arrival
    await vi.waitFor(() => expect(playBuffer).toHaveBeenCalledTimes(1))
    expect(decodeBytes).not.toHaveBeenCalled()
  })
})

describe('the speaker’s original voice, end to end through the hook', () => {
  const speaker = () => {
    const setVolume = vi.fn()
    room.remoteParticipants.set('speaker', {
      getTrackPublication: () => ({ track: { setVolume } }),
    } as never)
    return setVolume
  }
  const clipMessage = (id: string) =>
    encodeMessage({
      utteranceId: id,
      speakerId: 'speaker',
      lang: 'en-US',
      url: '/api/tts/' + 'a'.repeat(24),
      speechEndedAt: Date.now(),
    })

  it('is lowered while the clip plays and back to 1 when it ends', async () => {
    const setVolume = speaker()
    let finish!: () => void
    playBuffer.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'mute' }))
    send(TOPICS.audio, clipMessage('u1'))
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(0))
    await act(async () => finish())
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(1))
  })

  it('goes back to 1 when the tab is hidden in the middle of a clip', async () => {
    const setVolume = speaker()
    playBuffer.mockImplementationOnce(() => new Promise<void>(() => {})) // never ends
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'duck' }))
    send(TOPICS.audio, clipMessage('u1'))
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(0.15))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(1))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('a blocked audio context drops the clip and leaves the voice alone (and says so in the log)', async () => {
    const setVolume = speaker()
    ctx.running = false
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'mute' }))
    send(TOPICS.audio, clipMessage('u1'))
    await vi.waitFor(() =>
      expect(reportDiag).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio_blocked' })),
    )
    expect(setVolume).not.toHaveBeenCalledWith(0)
    expect(playBuffer).not.toHaveBeenCalled()
  })

  it('the audio context stopping mid-clip restores the voice', async () => {
    const setVolume = speaker()
    playBuffer.mockImplementationOnce(() => new Promise<void>(() => {}))
    renderHook(() => useTranslatedAudio({ sessionId: 's1', originalAudioMode: 'mute' }))
    send(TOPICS.audio, clipMessage('u1'))
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(0))
    ctx.running = false
    act(() => ctx.listeners.forEach((cb) => cb()))
    await vi.waitFor(() => expect(setVolume).toHaveBeenLastCalledWith(1))
  })
})
