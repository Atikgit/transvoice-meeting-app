process.env.TRANSLATION_PIPELINE = 'split'
process.env.OPENAI_API_KEY = 'sk-test'

import { http, HttpResponse } from 'msw'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { TONE_WAV_BASE64 } from '../mocks/transvoice'
import { encodeWav } from '@/lib/translation/wav'
import { decodeInlineAudio, TOPICS } from '@/lib/translation/messages'

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
const request = () => {
  const form = new FormData()
  form.set(
    'audio',
    new Blob([encodeWav(new Float32Array(16_000).fill(0.25))], { type: 'audio/wav' }),
  )
  form.set('sessionId', `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`)
  form.set('utteranceId', '33333333-3333-4333-8333-333333333333')
  form.set('clientTs', '1761300000000')
  return POST(
    new NextRequest('https://meet.transvoice.ai/api/translate', { method: 'POST', body: form }),
  )
}
const calls = { stt: 0, tts: 0, single: 0, openai: 0 }
const sse = (...d: string[]) =>
  new HttpResponse(
    [
      ...d.map((x) => `data: ${JSON.stringify({ choices: [{ delta: { content: x } }] })}\n\n`),
      'data: [DONE]\n\n',
    ].join(''),
  )

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(calls, { stt: 0, tts: 0, single: 0, openai: 0 })
  const me = `user-${++n}` // one speaker per test: the rate limiter is process-wide
  getSessionUser.mockImplementation(async () => ({ id: me }))
  rpc.mockResolvedValue({ data: context, error: null })
  listParticipants.mockImplementation(async () => [{ identity: me }, { identity: 'guest-1' }])
  splitBreaker.success()
  server.use(
    http.post(
      `${API}/v1/stt`,
      () => (calls.stt++, HttpResponse.json({ text: 'Good morning. How are you?', duration_s: 2 })),
    ),
    http.post(
      `${API}/v1/tts`,
      () => (calls.tts++, new HttpResponse(MP3, { headers: { 'Content-Type': 'audio/mpeg' } })),
    ),
    http.post(
      'https://api.openai.com/v1/chat/completions',
      () => (calls.openai++, sse('শুভ সকাল। ', 'আপনি কেমন আছেন?')),
    ),
    http.post(
      `${API}/`,
      () => (
        calls.single++,
        HttpResponse.json({ original_text: 'o', translated_text: 't', tts_audio: TONE_WAV_BASE64 })
      ),
    ),
  )
})

describe('POST /api/translate with TRANSLATION_PIPELINE=split', () => {
  it('STT once, translation streamed, one caption + one mp3 clip per sentence over LiveKit; no POST /', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await request()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ languages: [{ lang: 'bn-BD', result: 'speech' }] })
    expect(calls).toEqual({ stt: 1, tts: 2, single: 0, openai: 1 })

    const sent = sendData.mock.calls.map((c) => ({
      topic: (c[3] as { topic: string }).topic,
      data: c[1] as Uint8Array,
    }))
    expect(sent.filter((s) => s.topic === TOPICS.caption)).toHaveLength(2)
    const clips = sent
      .filter((s) => s.topic === TOPICS.audioInline)
      .map((s) => decodeInlineAudio(s.data)!)
    // 3000 bytes ≤ 12 KiB: inline, as served (mp3), with {seq, last}
    expect(
      clips.map((c) => [c.header.format, c.header.seq, c.header.last, c.audio.length]),
    ).toEqual([
      ['mp3', 0, false, 3000],
      ['mp3', 1, true, 3000],
    ])

    const line = info.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('"event":"translate"'))!
    const log = JSON.parse(line)
    expect(log.languages[0]).toMatchObject({
      pipeline: 'split',
      outcome: 'speech',
      sentences: 2,
    })
    for (const key of [
      'sttMs',
      'translateFirstTokenMs',
      'firstSentenceMs',
      'ttsFirstByteMs',
      'toFirstAudioMs',
    ])
      expect(log.languages[0][key], key).toEqual(expect.any(Number))
    expect(line).not.toContain('Good morning') // no text in the log
    info.mockRestore()
  })

  it('a clip over 12 KiB goes through /api/tts instead of the packet', async () => {
    server.use(http.post(`${API}/v1/tts`, () => new HttpResponse(new Uint8Array(20_000).fill(1))))
    await request()
    const topics = sendData.mock.calls.map((c) => (c[3] as { topic: string }).topic)
    expect(topics).toContain(TOPICS.audio)
    expect(topics).not.toContain(TOPICS.audioInline)
  })

  it('FALLBACK: STT failing runs the single POST / path, counted and logged', async () => {
    server.use(
      http.post(`${API}/v1/stt`, () => (calls.stt++, HttpResponse.json({}, { status: 500 }))),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await request()
    expect(await res.json()).toMatchObject({ languages: [{ lang: 'bn-BD', result: 'speech' }] })
    expect(calls).toMatchObject({ stt: 1, single: 1, openai: 0 })
    const log = JSON.parse(
      info.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"event":"translate"'))!,
    )
    expect(log.languages[0]).toMatchObject({ pipeline: 'single', fallback: 'stt' })
    expect(log.splitFailures).toBeGreaterThanOrEqual(1)
    warn.mockRestore()
    info.mockRestore()
  })

  it('FALLBACK: translation failing before the first sentence runs the single path', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await request()
    expect(calls.single).toBe(1)
  })

  it('the circuit breaker sends utterances straight to the single path while it is open', async () => {
    for (let i = 0; i < 5; i++) splitBreaker.failure()
    await request()
    expect(calls).toEqual({ stt: 0, tts: 0, single: 1, openai: 0 })
  })

  it('a "Silence" answer shows nothing and sends nothing', async () => {
    server.use(http.post('https://api.openai.com/v1/chat/completions', () => sse('Sil', 'ence')))
    const res = await request()
    expect(await res.json()).toMatchObject({ silence: true })
    expect(sendData).not.toHaveBeenCalled()
  })
})
