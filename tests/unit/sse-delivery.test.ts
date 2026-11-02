process.env.DELIVERY = 'sse'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENV } from '../mocks/env'
import { TOPICS } from '@/lib/translation/messages'

void TEST_ENV
const getSessionUser = vi.fn()
const rpc = vi.fn()
const listParticipants = vi.fn()
const sendData = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    listParticipants = listParticipants
    sendData = sendData
  },
}))

const { GET } = await import('@/app/api/stream/route')
const { subscribeSse, hasSseSubscriber } = await import('@/lib/translation/sse-hub')
const { deliverSentenceCaption, deliverSentenceClip } = await import('@/lib/translation/deliver')

const SESSION = '22222222-2222-4222-8222-000000000042'
const context = {
  hostId: 'host-1',
  hostEmail: 'host@example.com',
  speaker: {
    userId: 'guest-1',
    spokenLang: 'bn-BD',
    payerId: 'host-1',
    payerHasMinutes: true,
    voiceGender: 'male',
  },
  participants: [],
}
const open = (sessionId: string | null = SESSION, signal?: AbortSignal) =>
  GET(
    new NextRequest(
      `https://meet.transvoice.ai/api/stream${sessionId ? `?sessionId=${sessionId}` : ''}`,
      { signal },
    ),
  )

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: 'guest-1' })
  rpc.mockResolvedValue({ data: context, error: null })
  listParticipants.mockResolvedValue([{ identity: 'guest-1' }])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/stream', () => {
  it('401 without a session, 400 without a valid sessionId', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await open()).status).toBe(401)
    expect((await open('nope')).status).toBe(400)
  })

  it('403 for someone who is not a participant of the session', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_A_PARTICIPANT' } })
    expect((await open()).status).toBe(403)
  })

  it('is an event stream with the no-buffering headers, and pushes what the hub gets', async () => {
    const abort = new AbortController()
    const res = await open(SESSION, abort.signal)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    expect(res.headers.get('Cache-Control')).toContain('no-transform')
    expect(hasSseSubscriber(SESSION, 'guest-1')).toBe(true)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    await deliverSentenceCaption({
      sessionId: SESSION,
      utteranceId: 'u1',
      speakerId: 'host-1',
      speechEndedAt: 1,
      lang: 'bn-BD',
      listeners: ['guest-1'],
      original: 'hello',
      translated: 'হ্যালো',
    })
    let text = ''
    while (!text.includes('tvx.caption')) text += decoder.decode((await reader.read()).value)
    expect(text).toContain('event: m')
    expect(sendData).not.toHaveBeenCalled() // not sent over LiveKit as well
    abort.abort()
    await vi.waitFor(() => expect(hasSseSubscriber(SESSION, 'guest-1')).toBe(false))
  })

  it('sends a heartbeat comment every 15 s', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const res = await open(SESSION, abort.signal)
    const reader = res.body!.getReader()
    await reader.read() // the "connected" preamble
    await vi.advanceTimersByTimeAsync(15_000)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': ping\n\n')
    abort.abort()
  })
})

describe('DELIVERY=sse routing per listener', () => {
  const clip = (listeners: string[]) =>
    deliverSentenceClip({
      sessionId: SESSION,
      utteranceId: 'u2',
      speakerId: 'host-1',
      speechEndedAt: 1,
      lang: 'bn-BD',
      listeners,
      seq: 0,
      last: true,
      audio: new Uint8Array(2000).fill(5),
    })

  it('a listener with an open stream gets the clip over SSE (base64), the others over LiveKit', async () => {
    const frames: string[] = []
    const off = subscribeSse(SESSION, 'with-stream', { write: (f) => (frames.push(f), true) })
    await clip(['with-stream', 'without'])
    off()
    expect(frames).toHaveLength(1)
    const data = JSON.parse(frames[0]!.split('data: ')[1]!) as { t: string; b: string }
    expect(data.t).toBe(TOPICS.audioInline)
    expect(Buffer.from(data.b, 'base64').length).toBeGreaterThan(2000)
    expect(sendData).toHaveBeenCalledTimes(1)
    const options = sendData.mock.calls[0]![3] as { destinationIdentities: string[] }
    expect(options.destinationIdentities).toEqual(['without'])
  })

  it('a stream that refuses the write falls back to LiveKit for that listener', async () => {
    subscribeSse(SESSION, 'broken', { write: () => false })
    await clip(['broken'])
    const options = sendData.mock.calls[0]![3] as { destinationIdentities: string[] }
    expect(options.destinationIdentities).toEqual(['broken'])
  })

  it('no stream open: plain LiveKit, as before', async () => {
    await clip(['nobody'])
    expect(sendData).toHaveBeenCalledTimes(1)
  })
})
