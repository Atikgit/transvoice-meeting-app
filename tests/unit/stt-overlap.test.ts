process.env.TRANSLATION_PIPELINE = 'split'
process.env.OPENAI_API_KEY = 'sk-test'

import { http, HttpResponse } from 'msw'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { encodeWav } from '@/lib/translation/wav'

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

const { POST } = await import('@/app/api/translate/route')
const { splitBreaker } = await import('@/lib/translation/breaker')
const { __resetOverlapForTests } = await import('@/lib/translation/stt-overlap')

const API = TEST_ENV.TRANSVOICE_API_URL
const MP3 = new Uint8Array(3000).fill(9)
let n = 0
const context = {
  hostId: 'host-1',
  hostEmail: 'host@example.com',
  speaker: {
    userId: 'u',
    spokenLang: 'en-US',
    payerId: 'host-1',
    payerHasMinutes: true,
    voiceGender: 'male',
  },
  participants: [{ userId: 'guest-1', listenLang: 'bn-BD' }],
}
let SESSION = ''
const request = () => {
  const form = new FormData()
  form.set(
    'audio',
    new Blob([encodeWav(new Float32Array(16_000).fill(0.25))], { type: 'audio/wav' }),
  )
  form.set('sessionId', SESSION)
  form.set('utteranceId', `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`)
  form.set('clientTs', '1761300000000')
  return POST(
    new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body: form }),
  )
}
const calls = { stt: 0, tts: 0 }
const order: string[] = []
const sse = (...d: string[]) =>
  new HttpResponse(
    [
      ...d.map((x) => `data: ${JSON.stringify({ choices: [{ delta: { content: x } }] })}\n\n`),
      'data: [DONE]\n\n',
    ].join(''),
  )
let releaseContext: (() => void) | undefined
let holdContext = false

beforeEach(() => {
  vi.clearAllMocks()
  __resetOverlapForTests()
  Object.assign(calls, { stt: 0, tts: 0 })
  order.length = 0
  holdContext = false
  SESSION = `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`
  const me = `user-${++n}`
  getSessionUser.mockImplementation(async () => ({ id: me }))
  rpc.mockImplementation(async () => {
    order.push('context:start')
    if (holdContext) await new Promise<void>((r) => (releaseContext = r))
    order.push('context:done')
    return { data: context, error: null }
  })
  listParticipants.mockImplementation(async () => [{ identity: me }, { identity: 'guest-1' }])
  splitBreaker.success()
  server.use(
    http.post(`${API}/v1/stt`, () => {
      calls.stt++
      order.push('stt')
      return HttpResponse.json({ text: 'Good morning. How are you?', duration_s: 2 })
    }),
    http.post(
      `${API}/v1/tts`,
      () => (calls.tts++, new HttpResponse(MP3, { headers: { 'Content-Type': 'audio/mpeg' } })),
    ),
    http.post('https://api.openai.com/v1/chat/completions', () =>
      sse('শুভ সকাল। ', 'আপনি কেমন আছেন?'),
    ),
  )
})

describe('speech-to-text overlapped with the context lookup', () => {
  it('first utterance of a speaker: context and gate first, STT after (never before admission)', async () => {
    expect((await request()).status).toBe(200)
    expect(order.slice(0, 3)).toEqual(['context:start', 'context:done', 'stt'])
  })

  it('an already admitted speaker: STT starts while the context is still loading', async () => {
    await request() // admitted once: the language hint is stored
    order.length = 0
    holdContext = true
    const pending = request()
    await vi.waitFor(() => expect(order).toContain('stt'))
    expect(order).toEqual(['context:start', 'stt']) // context not done yet
    releaseContext?.()
    const res = await pending
    expect(res.status).toBe(200)
    expect(calls.stt).toBe(2) // one per utterance, not redone
    expect(calls.tts).toBe(4)
  })

  it('a refused gate throws the overlapped STT away: nothing is translated or sent', async () => {
    await request()
    sendData.mockClear()
    calls.tts = 0
    rpc.mockImplementation(async () => ({
      data: { ...context, speaker: { ...context.speaker, payerHasMinutes: false } },
      error: null,
    }))
    const res = await request()
    expect(res.status).not.toBe(200)
    expect(calls.tts).toBe(0)
    expect(sendData).not.toHaveBeenCalled()
    // ... and the refusal removes the hint: the next utterance waits for admission before STT
    await vi.waitFor(() => expect(calls.stt).toBe(2)) // the thrown-away overlapped STT
    const before = calls.stt
    order.length = 0
    rpc.mockImplementation(async () => {
      order.push('context:done')
      return { data: context, error: null }
    })
    await request()
    expect(order.indexOf('context:done')).toBeLessThan(order.indexOf('stt'))
    expect(calls.stt).toBe(before + 1)
  })

  it('the language changed since the last admission: the STT is redone with the new one', async () => {
    await request()
    calls.stt = 0
    rpc.mockImplementation(async () => ({
      data: {
        ...context,
        speaker: { ...context.speaker, spokenLang: 'bn-BD' },
        participants: [{ userId: 'guest-1', listenLang: 'en-US' }],
      },
      error: null,
    }))
    expect((await request()).status).toBe(200)
    await vi.waitFor(() => expect(calls.stt).toBe(2)) // the overlapped one (old language) + the redo
  })

  it('PIPELINE_OVERLAP off keeps the sequential order', async () => {
    const { serverEnv } = await import('@/lib/env')
    expect(serverEnv().PIPELINE_OVERLAP).toBe(true)
  })
})
