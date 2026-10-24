import { http, HttpResponse } from 'msw'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { encodeWav, isWav, wavSeconds } from '@/lib/translation/wav'

const getSessionUser = vi.fn()
const rpc = vi.fn()
const listParticipants = vi.fn()
const sendData = vi.fn(async () => {})
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
const { parseTranslateUpload, MAX_AUDIO_BYTES } = await import('@/lib/translation/request')

let n = 0
const SESSION = () => `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`
const UTTERANCE = '33333333-3333-4333-8333-333333333333'
const wav = (seconds = 1) => encodeWav(new Float32Array(16_000 * seconds).fill(0.25))

function form(fields: Record<string, string | Blob>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}
const upload = (session: string, audio: Blob = new Blob([wav()], { type: 'audio/wav' })) =>
  form({ audio, sessionId: session, utteranceId: UTTERANCE, clientTs: '1761300000000' })
const post = (body: FormData) =>
  POST(new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body }))

const context = {
  hostId: 'host-1',
  hostEmail: 'host@example.com',
  speaker: {
    userId: 'user-1',
    spokenLang: 'bn-BD',
    payerId: 'host-1',
    payerHasMinutes: true,
    voiceGender: 'female',
  },
  participants: [{ userId: 'guest-1', listenLang: 'en-US' }],
}

let me = 'user-0'
beforeEach(() => {
  vi.clearAllMocks()
  me = `user-${++n}` // one speaker per test: the rate limiter is process-wide
  getSessionUser.mockImplementation(async () => ({ id: me }))
  rpc.mockResolvedValue({ data: context, error: null })
  listParticipants.mockImplementation(async () => [{ identity: me }, { identity: 'guest-1' }])
})

describe('WAV encoding', () => {
  it('writes a 16 kHz mono 16-bit PCM header and clamps samples', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]))
    const view = new DataView(bytes.buffer)
    expect(isWav(bytes)).toBe(true)
    expect(bytes.length).toBe(44 + 8)
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect([
      view.getInt16(44, true),
      view.getInt16(46, true),
      view.getInt16(48, true),
      view.getInt16(50, true),
    ]).toEqual([0, 32767, -32768, 32767])
    expect(wavSeconds(wav(2).length)).toBe(2)
  })

  it('a 12 s utterance stays well under the 2 MB limit', () => {
    expect(wav(12).length).toBeLessThan(MAX_AUDIO_BYTES)
  })
})

describe('parseTranslateUpload', () => {
  it('accepts WAV with the required fields', async () => {
    const parsed = await parseTranslateUpload(upload(SESSION()))
    expect('error' in parsed).toBe(false)
  })

  it.each([
    [
      'missing audio',
      () => form({ sessionId: SESSION(), utteranceId: UTTERANCE, clientTs: '1' }),
      400,
    ],
    ['non-audio MIME', () => upload(SESSION(), new Blob([wav()], { type: 'text/plain' })), 415],
    [
      'WebM claimed as WAV',
      () => upload(SESSION(), new Blob([new Uint8Array(100)], { type: 'audio/wav' })),
      415,
    ],
    [
      'over 2 MB',
      () =>
        upload(SESSION(), new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/wav' })),
      413,
    ],
    [
      'bad ids',
      () =>
        form({
          audio: new Blob([wav()], { type: 'audio/wav' }),
          sessionId: 'x',
          utteranceId: 'y',
          clientTs: '1',
        }),
      400,
    ],
  ])('rejects %s', async (_label, make, status) => {
    expect(await parseTranslateUpload(make())).toMatchObject({ status })
  })
})

describe('POST /api/translate admission', () => {
  it('translates for a connected participant of a live session', async () => {
    const res = await post(upload(SESSION()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      utteranceId: UTTERANCE,
      original: expect.any(String),
      languages: [{ lang: 'en-US', result: 'speech' }],
    })
  })

  it('delivers to the listeners over LiveKit data (caption + audio)', async () => {
    await post(upload(SESSION()))
    const topics = sendData.mock.calls.map(
      (c) =>
        (
          c as unknown as [
            string,
            Uint8Array,
            number,
            { topic: string; destinationIdentities: string[] },
          ]
        )[3],
    )
    expect(topics).toEqual([
      { topic: 'tvx.caption', destinationIdentities: ['guest-1'] },
      { topic: 'tvx.audio', destinationIdentities: ['guest-1'] },
    ])
  })

  it('logs stage timings per utterance and nothing personal', async () => {
    const lines: string[] = []
    const info = vi
      .spyOn(console, 'info')
      .mockImplementation((line: string) => void lines.push(line))
    await post(upload(SESSION()))
    info.mockRestore()
    const entry = JSON.parse(lines.find((l) => l.includes('"event":"translate"'))!)
    expect(entry).toMatchObject({
      event: 'translate',
      audioBytes: expect.any(Number),
      intakeMs: expect.any(Number),
      contextMs: expect.any(Number),
      totalMs: expect.any(Number),
      languages: [
        {
          lang: 'en-US',
          outcome: 'speech',
          apiMs: expect.any(Number),
          captionMs: expect.any(Number),
          audioMs: expect.any(Number),
        },
      ],
    })
    const text = lines.join('\n')
    for (const secret of [
      'Hello, how are you?',
      'হ্যালো',
      'QQ==',
      'UklGR',
      me,
      'guest-1',
      'host-1',
      'host@example.com',
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  describe('same-language listeners (Rule: no API call, no TTS, original audio untouched)', () => {
    const apiCalls = () => {
      const bodies: { tgt_lang: string }[] = []
      server.use(
        http.post(`${TEST_ENV.TRANSVOICE_API_URL}/`, async ({ request }) => {
          bodies.push((await request.json()) as { tgt_lang: string })
          return HttpResponse.json({ original_text: 'o', translated_text: 't', tts_audio: 'QQ==' })
        }),
      )
      return bodies
    }
    const withListeners = (participants: { userId: string; listenLang: string }[]) =>
      rpc.mockResolvedValue({ data: { ...context, participants }, error: null })

    it('everyone hears the speaker language: nothing is translated or sent', async () => {
      const bodies = apiCalls()
      withListeners([
        { userId: 'guest-1', listenLang: 'bn-BD' },
        { userId: 'guest-2', listenLang: 'bn-IN' }, // same language, other region
      ])
      listParticipants.mockImplementation(async () => [
        { identity: me },
        { identity: 'guest-1' },
        { identity: 'guest-2' },
      ])
      const res = await post(upload(SESSION()))
      expect(await res.json()).toEqual({ utteranceId: UTTERANCE, languages: [] })
      expect(bodies).toEqual([])
      expect(sendData).not.toHaveBeenCalled()
    })

    it('mixed room: only the other-language listener gets a call, caption and audio', async () => {
      const bodies = apiCalls()
      withListeners([
        { userId: 'guest-1', listenLang: 'bn-BD' }, // same as the speaker
        { userId: 'guest-2', listenLang: 'en-US' },
      ])
      listParticipants.mockImplementation(async () => [
        { identity: me },
        { identity: 'guest-1' },
        { identity: 'guest-2' },
      ])
      await post(upload(SESSION()))
      expect(bodies.map((b) => b.tgt_lang)).toEqual(['en'])
      const destinations = sendData.mock.calls.map(
        (c) =>
          (c as unknown as [string, Uint8Array, number, { destinationIdentities: string[] }])[3]
            .destinationIdentities,
      )
      expect(destinations).toEqual([['guest-2'], ['guest-2']])
    })
  })

  it('private beta: a meeting hosted by someone else gets 403 BETA and no translation', async () => {
    rpc.mockResolvedValue({ data: { ...context, hostEmail: 'stranger@example.com' }, error: null })
    const res = await post(upload(SESSION()))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      code: 'BETA',
      error: 'Live translation is in private beta.',
    })
    expect(sendData).not.toHaveBeenCalled()
  })

  it('needs minutes: 402 PAYER_NO_MINUTES when the payer ran out', async () => {
    rpc.mockResolvedValue({
      data: { ...context, speaker: { ...context.speaker, payerHasMinutes: false } },
      error: null,
    })
    const res = await post(upload(SESSION()))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: 'PAYER_NO_MINUTES' })
    expect(sendData).not.toHaveBeenCalled()
  })

  it('401 signed out', async () => {
    getSessionUser.mockImplementation(async () => null)
    expect((await post(upload(SESSION()))).status).toBe(401)
  })

  it('403 when not connected to the LiveKit room', async () => {
    listParticipants.mockResolvedValue([{ identity: 'guest-1' }])
    const res = await post(upload(SESSION()))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('NOT_CONNECTED')
  })

  it.each([
    ['SESSION_NOT_LIVE', 409],
    ['NOT_A_PARTICIPANT', 403],
  ])('%s → %i', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } })
    expect((await post(upload(SESSION()))).status).toBe(status)
  })

  it('rate-limits to 30 per minute per user', async () => {
    const session = SESSION()
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await post(upload(session))).status)
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })
})
