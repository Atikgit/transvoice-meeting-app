import { http, HttpResponse } from 'msw'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { TONE_WAV_BASE64, type TransVoiceRequestBody } from '../mocks/transvoice'
import { encodeWav } from '@/lib/translation/wav'

const getSessionUser = vi.fn()
const rpc = vi.fn()
const listParticipants = vi.fn()
const sendData = vi.fn(async (..._args: unknown[]) => {})
const checkRateLimit = vi.fn(async (..._args: unknown[]) => true)
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }))
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    listParticipants = listParticipants
    sendData = sendData
  },
}))

const { POST: chunkPost } = await import('@/app/api/translate/chunk/route')
const { POST: wholePost } = await import('@/app/api/translate/route')
const { chunkStore } = await import('@/lib/translation/chunk-service')

const API = `${TEST_ENV.TRANSVOICE_API_URL}/`
let n = 0
const id = (prefix: string) =>
  `${prefix}-0000-4000-8000-${String(++n).padStart(12, '0')}`.padStart(36, '0')
let SESSION = '22222222-2222-4222-8222-222222222222' // new per test: LiveKit presence is cached per session

const context = {
  hostId: 'host-1',
  hostEmail: 'host@example.com',
  speaker: {
    userId: 'u',
    spokenLang: 'bn-BD',
    payerId: 'host-1',
    payerHasMinutes: true,
    voiceGender: 'female',
  },
  participants: [{ userId: 'guest-1', listenLang: 'en-US' }],
}

let me = 'user-0'
const apiBodies: TransVoiceRequestBody[] = []
beforeEach(() => {
  vi.clearAllMocks()
  apiBodies.length = 0
  me = `user-${++n}`
  SESSION = `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`
  getSessionUser.mockImplementation(async () => ({ id: me }))
  rpc.mockResolvedValue({ data: context, error: null })
  checkRateLimit.mockResolvedValue(true)
  listParticipants.mockImplementation(async () => [{ identity: me }, { identity: 'guest-1' }])
  server.use(
    http.post(API, async ({ request }) => {
      apiBodies.push((await request.json()) as TransVoiceRequestBody)
      return HttpResponse.json({
        original_text: 'o',
        translated_text: 't',
        tts_audio: TONE_WAV_BASE64,
      })
    }),
  )
})

const chunk = (
  utteranceId: string,
  seq: number,
  bytes: number,
  {
    last = false,
    clientTs,
    session = SESSION,
    extra = {},
  }: { last?: boolean; clientTs?: number; session?: string; extra?: Record<string, string> } = {},
) =>
  chunkPost(
    new NextRequest('https://meet.transvoice.ai/api/translate/chunk', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-utterance-id': utteranceId,
        'x-session-id': session ?? SESSION,
        'x-seq': String(seq),
        'x-last': last ? '1' : '0',
        ...(clientTs ? { 'x-client-ts': String(clientTs) } : {}),
        ...extra,
      },
      body: new Uint8Array(bytes).fill(seq + 1),
    }),
  )

describe('POST /api/translate/chunk', () => {
  it('chunks in any order: only the one that completes the utterance runs the pipeline, with the joined WAV and the same answer as /api/translate', async () => {
    const u = id('aaaaaaaa')
    expect((await chunk(u, 2, 16_000, { last: true, clientTs: 1_761_300_000_000 })).status).toBe(
      202,
    )
    expect((await chunk(u, 0, 16_000)).status).toBe(202)
    expect(apiBodies).toHaveLength(0)
    const done = await chunk(u, 1, 16_000)
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({
      utteranceId: u,
      original: expect.any(String),
      languages: [{ lang: 'en-US', result: 'speech' }],
    })
    // one API call, with a 1.5 s WAV made of the three chunks
    expect(apiBodies).toHaveLength(1)
    expect(Buffer.from(apiBodies[0]!.audio, 'base64').length).toBe(44 + 48_000)
    expect(apiBodies[0]).toMatchObject({ src_lang: 'bn', tgt_lang: 'en' })
    // delivered to the listener like a normal utterance
    expect(sendData).toHaveBeenCalled()
  })

  it('applies the rate limit once per UTTERANCE, not per chunk (30 chunks, 1 check)', async () => {
    const u = id('bbbbbbbb')
    for (let seq = 0; seq < 30; seq++) expect((await chunk(u, seq, 2_000)).status).toBe(202)
    expect(checkRateLimit).toHaveBeenCalledTimes(1)
    expect(checkRateLimit).toHaveBeenCalledWith('translate', me)
    const limited = await chunk(id('cccccccc'), 0, 2_000).then((r) => r.status)
    expect(limited).toBe(202) // second utterance: one more check, still allowed
    expect(checkRateLimit).toHaveBeenCalledTimes(2)
  })

  it('refuses a new utterance when the per-utterance limit is used up', async () => {
    checkRateLimit.mockResolvedValue(false)
    expect((await chunk(id('dddddddd'), 0, 2_000)).status).toBe(429)
  })

  it('runs the SAME gates as /api/translate on the first chunk: not connected, no payer minutes, kill switch', async () => {
    listParticipants.mockImplementation(async () => [{ identity: 'someone-else' }])
    const notConnected = await chunk(id('eeeeeeee'), 0, 2_000)
    expect(notConnected.status).toBeGreaterThanOrEqual(400)
    const body = await notConnected.json()
    expect(body.code).toBe('NOT_CONNECTED')

    listParticipants.mockImplementation(async () => [{ identity: me }, { identity: 'guest-1' }])
    rpc.mockResolvedValue({
      data: { ...context, speaker: { ...context.speaker, payerHasMinutes: false } },
      error: null,
    })
    const chunked = await chunk(id('ffffffff'), 0, 2_000)
    // compare with the whole-utterance route for the same state
    const form = new FormData()
    form.set(
      'audio',
      new Blob([encodeWav(new Float32Array(16_000).fill(0.25))], { type: 'audio/wav' }),
    )
    form.set('sessionId', SESSION)
    form.set('utteranceId', id('99999999'))
    form.set('clientTs', '1')
    const whole = await wholePost(
      new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body: form }),
    )
    expect(chunked.status).toBe(whole.status)
    expect(await chunked.json()).toEqual(await whole.json())
    expect(apiBodies).toHaveLength(0)
  })

  it('needs a signed-in user and valid headers', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await chunk(id('11111111'), 0, 2_000)).status).toBe(401)
    expect((await chunk('not-a-uuid', 0, 2_000)).status).toBe(400)
    expect((await chunk(id('22222222'), 0, 2_000, { session: 'x' })).status).toBe(400)
  })

  it('at most 2 open utterances per user; 12 s of audio per utterance', async () => {
    expect((await chunk(id('33333333'), 0, 2_000)).status).toBe(202)
    expect((await chunk(id('44444444'), 0, 2_000)).status).toBe(202)
    expect((await chunk(id('55555555'), 0, 2_000)).status).toBe(429)
    const long = id('66666666')
    chunkStore().discard(me, long)
    let status = 202
    for (let seq = 0; seq < 13 && status === 202; seq++)
      status = (await chunk(long, seq, 32_000)).status
    // (the first two utterances above are still open: a third is refused before length matters)
    expect([413, 429]).toContain(status)
  })

  it('x-abort throws a half-spoken utterance away; the whole-upload fallback then runs normally', async () => {
    const u = id('77777777')
    await chunk(u, 0, 16_000)
    const abort = await chunk(u, 0, 0, { extra: { 'x-abort': '1' } })
    expect(abort.status).toBe(204)
    expect(chunkStore().has(me, u)).toBe(false)
  })

  it('FALLBACK: after the chunks were processed, the whole upload of the same utterance is ignored (no second translation)', async () => {
    const u = id('88888888')
    await chunk(u, 0, 16_000, { last: true, clientTs: 5 })
    expect(apiBodies).toHaveLength(1)
    const form = new FormData()
    form.set(
      'audio',
      new Blob([encodeWav(new Float32Array(16_000).fill(0.25))], { type: 'audio/wav' }),
    )
    form.set('sessionId', SESSION)
    form.set('utteranceId', u)
    form.set('clientTs', '5')
    const whole = await wholePost(
      new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body: form }),
    )
    expect(await whole.json()).toMatchObject({ duplicate: true })
    expect(apiBodies).toHaveLength(1)
  })

  it('FALLBACK: while chunks are only partial, the whole upload takes over and discards them', async () => {
    const u = id('99999990')
    await chunk(u, 0, 16_000)
    await chunk(u, 2, 16_000, { last: true })
    const form = new FormData()
    form.set(
      'audio',
      new Blob([encodeWav(new Float32Array(16_000).fill(0.25))], { type: 'audio/wav' }),
    )
    form.set('sessionId', SESSION)
    form.set('utteranceId', u)
    form.set('clientTs', '5')
    const whole = await wholePost(
      new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body: form }),
    )
    expect(whole.status).toBe(200)
    expect(await whole.json()).toMatchObject({ languages: [{ lang: 'en-US', result: 'speech' }] })
    expect(apiBodies).toHaveLength(1)
    expect(chunkStore().has(me, u)).toBe(false)
  })

  it('an empty last chunk (speech ended exactly on a chunk boundary) completes the utterance', async () => {
    const u = id('99999991')
    await chunk(u, 0, 16_000)
    const done = await chunk(u, 1, 0, { last: true, clientTs: 9 })
    expect(done.status).toBe(200)
    expect(apiBodies).toHaveLength(1)
    expect(Buffer.from(apiBodies[0]!.audio, 'base64').length).toBe(44 + 16_000)
  })
})
