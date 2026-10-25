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

const decoded = { duration: 1 } as AudioBuffer
const decodeBytes = vi.fn(async () => decoded)
const fetchAndDecode = vi.fn(async () => decoded)
const playBuffer = vi.fn(async () => {})
vi.mock('@/features/translation/web-audio', () => ({
  decodeBytes,
  fetchAndDecode,
  playBuffer,
  unlockAudioOnFirstGesture: () => () => {},
}))
const reportLatency = vi.fn()
vi.mock('@/features/translation/latency-beacon', () => ({ reportLatency }))

const { useTranslatedAudio } = await import('@/features/translation/useTranslatedAudio')
const send = (topic: string, payload: Uint8Array) =>
  act(() => handlers.forEach((h) => h(payload, undefined, 0, topic)))

beforeEach(() => {
  handlers.length = 0
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
