import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { TransVoiceApiError, translateSpeech } from '@/lib/transvoice/client'
import { TEST_ENV } from '../mocks/env'
import { server } from '../mocks/server'
import { SILENT_AUDIO, type TransVoiceRequestBody } from '../mocks/transvoice'

const API = `${TEST_ENV.TRANSVOICE_API_URL}/`

const input = {
  audio: 'c3BlZWNo',
  srcLang: 'bn',
  tgtLang: 'en',
  azureVoice: 'en-US-AvaNeural',
  sessionId: 'session-1',
  speakerId: 'speaker-1',
}

describe('translateSpeech', () => {
  it('returns transcript, translation and TTS audio', async () => {
    const result = await translateSpeech(input)
    expect(result).toEqual({
      kind: 'speech',
      originalText: 'হ্যালো, আপনি কেমন আছেন?',
      translatedText: 'Hello, how are you?',
      ttsAudio: expect.any(String),
    })
  })

  it('sends the API contract fields, including session_id and speaker_id', async () => {
    let received: TransVoiceRequestBody | undefined
    server.use(
      http.post(API, async ({ request }) => {
        received = (await request.json()) as TransVoiceRequestBody
        return HttpResponse.json({ error: 'Silence' })
      }),
    )
    await translateSpeech(input)
    expect(received).toEqual({
      audio: 'c3BlZWNo',
      src_lang: 'bn',
      tgt_lang: 'en',
      azure_voice: 'en-US-AvaNeural',
      session_id: 'session-1',
      speaker_id: 'speaker-1',
    })
  })

  it('maps {"error":"Silence"} to a silence result', async () => {
    await expect(translateSpeech({ ...input, audio: SILENT_AUDIO })).resolves.toEqual({
      kind: 'silence',
    })
  })

  it('throws a retryable error on 5xx', async () => {
    server.use(http.post(API, () => new HttpResponse(null, { status: 503 })))
    const error = await translateSpeech(input).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransVoiceApiError)
    expect(error).toMatchObject({ status: 503, retryable: true })
  })

  it('throws a non-retryable error on 4xx', async () => {
    server.use(http.post(API, () => new HttpResponse(null, { status: 400 })))
    await expect(translateSpeech(input)).rejects.toMatchObject({ status: 400, retryable: false })
  })

  it('rejects unexpected payloads', async () => {
    server.use(http.post(API, () => HttpResponse.json({ foo: 'bar' })))
    await expect(translateSpeech(input)).rejects.toMatchObject({ retryable: false })
  })

  it('times out slow responses as a retryable error', async () => {
    server.use(
      http.post(API, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return HttpResponse.json({ error: 'Silence' })
      }),
    )
    await expect(
      translateSpeech(input, {
        baseUrl: TEST_ENV.TRANSVOICE_API_URL,
        apiKey: TEST_ENV.TRANSVOICE_MASTER_API_KEY,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ status: null, retryable: true })
  })
})
