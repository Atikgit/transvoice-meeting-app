import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import { SILENT_AUDIO, transvoiceHandlers, type TransVoiceRequestBody } from '../mocks/transvoice'
import { CircuitBreaker } from '@/lib/translation/breaker'
import { groupListeners, sourceLang, translateForListeners } from '@/lib/translation/fanout'

const API = `${TEST_ENV.TRANSVOICE_API_URL}/`

/** Records request bodies while answering with the default contract mock. */
function recordRequests() {
  const bodies: TransVoiceRequestBody[] = []
  server.use(
    http.post(API, async ({ request, requestId }) => {
      bodies.push((await request.clone().json()) as TransVoiceRequestBody)
      return transvoiceHandlers[0]!.run({ request, requestId }).then((r) => r!.response!)
    }),
  )
  return bodies
}

const base = {
  audioBase64: 'UklGRg==',
  spokenLang: 'bn-BD',
  voiceGender: 'male' as const,
  sessionId: 'session-1',
  speakerId: 'speaker-1',
}

describe('groupListeners', () => {
  it('groups by target locale and leaves out same-language listeners', () => {
    const groups = groupListeners(
      [
        { userId: 'a', listenLang: 'en-US' },
        { userId: 'b', listenLang: 'en-US' },
        { userId: 'c', listenLang: 'es-MX' },
        { userId: 'd', listenLang: 'bn-BD' }, // same as the speaker
        { userId: 'e', listenLang: 'bn-IN' }, // same language, other region
      ],
      'bn-BD',
    )
    expect(Object.fromEntries(groups)).toEqual({ 'en-US': ['a', 'b'], 'es-MX': ['c'] })
  })

  it('maps the speaker language to Whisper codes', () => {
    expect(sourceLang('bn-BD')).toBe('bn')
    expect(sourceLang('fil-PH')).toBe('tl')
    expect(sourceLang('zu-ZA')).toBe('auto') // listen-only language
  })
})

describe('translateForListeners (TransVoice API contract)', () => {
  it('calls the API once per target language, in parallel, with the contract fields', async () => {
    const bodies = recordRequests()
    const results = await translateForListeners({
      ...base,
      groups: new Map([
        ['en-US', ['a', 'b']],
        ['es-ES', ['c']],
      ]),
      breaker: new CircuitBreaker(),
    })
    expect(bodies).toHaveLength(2)
    expect(bodies.find((b) => b.tgt_lang === 'en')).toEqual({
      audio: 'UklGRg==',
      src_lang: 'bn',
      tgt_lang: 'en',
      azure_voice: 'en-US-AndrewNeural',
      session_id: 'session-1',
      speaker_id: 'speaker-1',
    })
    expect(bodies.find((b) => b.tgt_lang === 'es')?.azure_voice).toBe('es-ES-AlvaroNeural')
    expect(results.map((r) => [r.lang, r.kind, r.listeners])).toEqual([
      ['en-US', 'speech', ['a', 'b']],
      ['es-ES', 'speech', ['c']],
    ])
    expect(results[0]).toMatchObject({
      translatedText: 'Hello, how are you?',
      originalText: expect.any(String),
    })
  })

  it('makes no call when every listener speaks the speaker language', async () => {
    const bodies = recordRequests()
    const groups = groupListeners([{ userId: 'd', listenLang: 'bn-BD' }], 'bn-BD')
    expect(await translateForListeners({ ...base, groups, breaker: new CircuitBreaker() })).toEqual(
      [],
    )
    expect(bodies).toEqual([])
  })

  it('ignores {"error":"Silence"}', async () => {
    const [result] = await translateForListeners({
      ...base,
      audioBase64: SILENT_AUDIO,
      groups: new Map([['en-US', ['a']]]),
      breaker: new CircuitBreaker(),
    })
    expect(result).toMatchObject({ kind: 'silence' })
  })

  it('retries once on 5xx, not on 4xx', async () => {
    let calls = 0
    server.use(
      http.post(API, () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json({ error: 'busy' }, { status: 503 })
          : HttpResponse.json({ original_text: 'o', translated_text: 't', tts_audio: 'QQ==' })
      }),
    )
    const [ok] = await translateForListeners({
      ...base,
      groups: new Map([['en-US', ['a']]]),
      breaker: new CircuitBreaker(),
    })
    expect(ok).toMatchObject({ kind: 'speech' })
    expect(calls).toBe(2)

    calls = 0
    server.use(
      http.post(API, () => ((calls += 1), HttpResponse.json({ error: 'bad' }, { status: 400 }))),
    )
    const [bad] = await translateForListeners({
      ...base,
      groups: new Map([['en-US', ['a']]]),
      breaker: new CircuitBreaker(),
    })
    expect(bad).toMatchObject({ kind: 'failed', reason: 'error' })
    expect(calls).toBe(1)
  })

  it('times out after 4 s without retrying', async () => {
    let calls = 0
    const translate = async () => {
      calls += 1
      const { TransVoiceApiError } = await import('@/lib/transvoice/client')
      throw new TransVoiceApiError(
        'TransVoice API request failed: The operation was aborted due to timeout',
        null,
        true,
      )
    }
    const [result] = await translateForListeners({
      ...base,
      groups: new Map([['en-US', ['a']]]),
      translate,
      breaker: new CircuitBreaker(),
    })
    expect(result).toMatchObject({ kind: 'failed', reason: 'timeout' })
    expect(calls).toBe(1)
  })

  it('one language failing does not block the others', async () => {
    server.use(
      http.post(API, async ({ request }) => {
        const body = (await request.json()) as TransVoiceRequestBody
        return body.tgt_lang === 'es'
          ? HttpResponse.json({ error: 'x' }, { status: 400 })
          : HttpResponse.json({ original_text: 'o', translated_text: 'Hello', tts_audio: 'QQ==' })
      }),
    )
    const results = await translateForListeners({
      ...base,
      groups: new Map([
        ['en-US', ['a']],
        ['es-ES', ['b']],
      ]),
      breaker: new CircuitBreaker(),
    })
    expect(results.map((r) => r.kind)).toEqual(['speech', 'failed'])
  })
})

describe('CircuitBreaker', () => {
  it('opens after 5 consecutive failures, skips calls, then half-opens after 30 s', async () => {
    let now = 0
    const breaker = new CircuitBreaker(5, 30_000, () => now)
    let calls = 0
    server.use(
      http.post(API, () => ((calls += 1), HttpResponse.json({ error: 'down' }, { status: 400 }))),
    )
    const once = () =>
      translateForListeners({ ...base, groups: new Map([['en-US', ['a']]]), breaker }).then(
        (r) => r[0]!,
      )
    for (let i = 0; i < 5; i++) await once()
    expect(breaker.state).toBe('open')
    expect(await once()).toMatchObject({ kind: 'failed', reason: 'circuit_open' })
    expect(calls).toBe(5)

    now = 30_000
    expect(breaker.state).toBe('half-open')
    server.use(
      http.post(API, () =>
        HttpResponse.json({ original_text: 'o', translated_text: 't', tts_audio: 'QQ==' }),
      ),
    )
    expect(await once()).toMatchObject({ kind: 'speech' })
    expect(breaker.state).toBe('closed')
  })
})

describe('failure details for the log', () => {
  it('keeps the HTTP status of a failed API call (401 = wrong key) and no content', async () => {
    const { TransVoiceApiError } = await import('@/lib/transvoice/client')
    const { CircuitBreaker } = await import('@/lib/translation/breaker')
    const results = await translateForListeners({
      audioBase64: 'AAAA',
      spokenLang: 'bn-BD',
      voiceGender: 'female',
      groups: new Map([['en-US', ['guest-1']]]),
      sessionId: 's',
      speakerId: 'u',
      breaker: new CircuitBreaker(),
      translate: async () => {
        throw new TransVoiceApiError('TransVoice API responded 401', 401, false)
      },
    })
    expect(results[0]).toMatchObject({
      kind: 'failed',
      reason: 'error',
      status: 401,
      detail: 'TransVoice API responded 401',
    })
  })
})
