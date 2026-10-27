// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: vi.fn(),
  useRemoteParticipants: vi.fn(),
}))
vi.mock('@/features/translation/useSpeechDetector', () => ({ useSpeechDetector: vi.fn() }))

const { uploadUtterance } = await import('@/features/translation/useLiveTranslation')

const utterance = { samples: new Float32Array(1600), endedAt: 0, startedAt: 0 } as never
const args = { sessionId: 's', utteranceId: 'u', utterance }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('uploadUtterance', () => {
  it('retries once after 2 s when the server is draining (503 retryable)', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { code: 'DRAINING', retryable: true }))
      .mockResolvedValueOnce(json(200, { utteranceId: 'u' }))
    const result = uploadUtterance(args)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after that one retry', async () => {
    fetchMock.mockImplementation(async () => json(503, { retryable: true }))
    const result = uploadUtterance(args)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await result).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    [503, { error: 'busy' }],
    [500, { retryable: true }],
    [402, { code: 'PAYER_NO_MINUTES' }],
  ])('does not retry a %s without a retryable 503', async (status, body) => {
    fetchMock.mockResolvedValue(json(status, body))
    expect((await uploadUtterance(args)).status).toBe(status)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the group and sequence number of a piece of a long speech, and wav by default', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}))
    const group = crypto.randomUUID()
    await uploadUtterance({ ...args, chunk: { group, seq: 2 } })
    const form = (fetchMock.mock.calls[0]![1] as { body: FormData }).body
    expect(form.get('group')).toBe(group)
    expect(form.get('seq')).toBe('2')
    expect((form.get('audio') as Blob).type).toBe('audio/wav')
  })

  it('falls back to wav when the browser cannot encode opus', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}))
    const sent = vi.fn()
    await uploadUtterance({ ...args, format: 'opus' }, sent) // jsdom has no AudioEncoder
    expect(sent).toHaveBeenCalledWith(expect.any(Number), { format: 'wav', bytes: 44 + 3200 })
    const form = (fetchMock.mock.calls[0]![1] as { body: FormData }).body
    expect((form.get('audio') as Blob).type).toBe('audio/wav')
  })
})
