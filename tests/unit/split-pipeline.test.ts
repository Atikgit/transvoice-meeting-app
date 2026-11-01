import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TEST_ENV } from '../mocks/env'
import {
  SplitStepError,
  streamTranslation,
  synthesize,
  transcribe,
  translationPrompt,
  type SplitConfig,
} from '@/lib/transvoice/split-client'
import { runSplitPipeline, type SplitDeps } from '@/lib/translation/split/pipeline'

const API = TEST_ENV.TRANSVOICE_API_URL
const config: SplitConfig = {
  baseUrl: API,
  apiKey: TEST_ENV.TRANSVOICE_MASTER_API_KEY,
  openaiKey: 'sk-test',
  model: 'gpt-4o-mini',
  provider: 'openai',
}
const MP3 = new Uint8Array(2000).fill(7) // anything over 1000 bytes counts as a clip
const sse = (...deltas: string[]) =>
  new HttpResponse(
    [
      ...deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`),
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

async function collect(stream: AsyncIterable<string>) {
  let text = ''
  for await (const piece of stream) text += piece
  return text
}

describe('split steps against the API contract', () => {
  it('STT: POST /v1/stt {audio, ext, lang} with the Bearer key → {text, durationS}', async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | undefined
    server.use(
      http.post(`${API}/v1/stt`, async ({ request }) => {
        seen = { auth: request.headers.get('authorization'), body: (await request.json()) as never }
        return HttpResponse.json({ text: 'ওহে', duration_s: 1.5 })
      }),
    )
    expect(await transcribe(config, 'QUJD', 'wav', 'bn')).toEqual({ text: 'ওহে', durationS: 1.5 })
    expect(seen).toEqual({
      auth: `Bearer ${TEST_ENV.TRANSVOICE_MASTER_API_KEY}`,
      body: { audio: 'QUJD', ext: 'wav', lang: 'bn' },
    })
  })

  it('STT errors become SplitStepError (status, bad payload, timeout)', async () => {
    server.use(http.post(`${API}/v1/stt`, () => HttpResponse.json({}, { status: 500 })))
    await expect(transcribe(config, 'x', 'wav', 'bn')).rejects.toMatchObject({
      step: 'stt',
      status: 500,
    })
    server.use(http.post(`${API}/v1/stt`, () => HttpResponse.json({ nope: 1 })))
    await expect(transcribe(config, 'x', 'wav', 'bn')).rejects.toBeInstanceOf(SplitStepError)
    server.use(
      http.post(`${API}/v1/stt`, async () => {
        await new Promise((r) => setTimeout(r, 300))
        return HttpResponse.json({ text: 'late', duration_s: 1 })
      }),
    )
    await expect(transcribe({ ...config, timeoutMs: 50 }, 'x', 'wav', 'bn')).rejects.toMatchObject({
      step: 'stt',
      message: expect.stringContaining('timeout'),
    })
  })

  it('TTS: POST /v1/tts {text, voice} → the mp3 bytes as they are, with the first-byte time', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post(`${API}/v1/tts`, async ({ request }) => {
        body = (await request.json()) as never
        return new HttpResponse(MP3, { headers: { 'Content-Type': 'audio/mpeg' } })
      }),
    )
    const clip = await synthesize(config, 'Hello', 'en-US-AvaNeural')
    expect(body).toEqual({ text: 'Hello', voice: 'en-US-AvaNeural' })
    expect(clip.audio).toEqual(MP3)
    expect(clip.firstByteMs).toBeGreaterThanOrEqual(0)
    server.use(http.post(`${API}/v1/tts`, () => new HttpResponse(null, { status: 502 })))
    await expect(synthesize(config, 'x', 'v')).rejects.toMatchObject({ step: 'tts', status: 502 })
  })

  it('translate (OpenAI): streams gpt-4o-mini deltas with the translator prompt and full language name', async () => {
    let body:
      { model: string; stream: boolean; messages: { role: string; content: string }[] } | undefined
    let auth: string | null = null
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        auth = request.headers.get('authorization')
        body = (await request.json()) as never
        return sse('শুভ ', 'সকাল।')
      }),
    )
    expect(await collect(streamTranslation(config, 'Good morning.', 'bn-BD'))).toBe('শুভ সকাল।')
    expect(auth).toBe('Bearer sk-test')
    expect(body).toMatchObject({ model: 'gpt-4o-mini', stream: true })
    expect(body!.messages[0]).toEqual({ role: 'system', content: translationPrompt('bn-BD') })
    expect(body!.messages[0]!.content).toContain('Translate the given text accurately to Bengali.')
    expect(body!.messages[0]!.content).toContain("output ONLY the exact word 'Silence'")
    expect(body!.messages[1]).toEqual({ role: 'user', content: 'Good morning.' })
  })

  it('translate (api-chat, no OpenAI key): /v1/chat with the prompt as top-level `system`', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post(`${API}/v1/chat`, async ({ request }) => {
        body = (await request.json()) as never
        return new HttpResponse('Hola.', { headers: { 'Content-Type': 'text/plain' } })
      }),
    )
    const chat: SplitConfig = { ...config, openaiKey: undefined, provider: 'api-chat' }
    expect(await collect(streamTranslation(chat, 'Hello.', 'es-MX'))).toBe('Hola.')
    expect(body).toEqual({
      system: translationPrompt('es-MX'),
      messages: [{ role: 'user', content: 'Hello.' }],
    })
  })

  it('translate without a configured translator fails as a translate step', async () => {
    const none: SplitConfig = { ...config, openaiKey: undefined, provider: 'openai' }
    await expect(collect(streamTranslation(none, 'x', 'bn'))).rejects.toMatchObject({
      step: 'translate',
    })
  })
})

// ---------------------------------------------------------------------------------------------
type Clip = { lang: string; seq: number; last: boolean; bytes: number }

function harness(
  over: Partial<SplitDeps> & {
    stream?: (text: string, lang: string) => AsyncGenerator<string>
  } = {},
) {
  const captions: { lang: string; translated: string; seq: number }[] = []
  const clips: Clip[] = []
  const calls = { stt: 0, translate: [] as string[], tts: [] as string[] }
  const deps: SplitDeps = {
    config,
    transcribe: async () => {
      calls.stt++
      return { text: 'Good morning. How are you?', durationS: 2 }
    },
    streamTranslation:
      over.streamTranslation ??
      async function* (_c, _t, lang) {
        calls.translate.push(lang)
        yield 'First sentence. '
        yield 'Second sentence! '
        yield 'Third one'
      },
    synthesize:
      over.synthesize ??
      (async (_c, text, voice) => {
        calls.tts.push(voice)
        void text
        return { audio: MP3, firstByteMs: 5 }
      }),
    deliverCaption: async (lang, _l, c) =>
      void captions.push({ lang, translated: c.translated, seq: c.seq }),
    deliverClip: async (lang, _l, c) =>
      void clips.push({ lang, seq: c.seq, last: c.last, bytes: c.audio.length }),
    ...over,
  }
  return { deps, captions, clips, calls }
}
const run = (deps: SplitDeps, groups = new Map([['bn-BD', ['g1']]])) =>
  runSplitPipeline({
    audioBase64: 'QUJD',
    ext: 'wav',
    spokenSrcLang: 'en',
    voiceGender: 'male',
    groups,
    startedAt: performance.now(),
    deps,
  })

describe('runSplitPipeline', () => {
  it('does STT once for several languages; per language: captions per sentence, clips in order, last on the final one', async () => {
    const h = harness()
    const out = await run(
      h.deps,
      new Map([
        ['bn-BD', ['a']],
        ['es-MX', ['b']],
      ]),
    )
    expect(h.calls.stt).toBe(1)
    expect(h.calls.translate.sort()).toEqual(['bn-BD', 'es-MX'])
    for (const lang of ['bn-BD', 'es-MX']) {
      expect(h.captions.filter((c) => c.lang === lang).map((c) => c.translated)).toEqual([
        'First sentence.',
        'First sentence. Second sentence!',
        'First sentence. Second sentence! Third one',
      ])
      expect(h.clips.filter((c) => c.lang === lang).map((c) => [c.seq, c.last])).toEqual([
        [0, false],
        [1, false],
        [2, true],
      ])
    }
    expect(out.languages.every((l) => l.kind === 'speech')).toBe(true)
    const bn = out.languages[0]!
    expect(bn).toMatchObject({ kind: 'speech', sentences: 3, clips: 3, audioMissing: false })
    if (bn.kind === 'speech') {
      expect(bn.timings).toMatchObject({
        sttMs: expect.any(Number),
        translateFirstTokenMs: expect.any(Number),
        firstSentenceMs: expect.any(Number),
        ttsFirstByteMs: 5,
        toFirstAudioMs: expect.any(Number),
      })
    }
  })

  it('starts sentence 1 speech before the translation has finished', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h = harness({
      streamTranslation: async function* () {
        yield 'One sentence here. '
        await gate // the rest of the translation is still being produced
        yield 'Another one.'
      },
    })
    const running = run(h.deps)
    await vi.waitFor(() => expect(h.clips.map((c) => c.seq)).toEqual([0]))
    expect(h.clips[0]!.last).toBe(false)
    release()
    await running
    expect(h.clips.map((c) => [c.seq, c.last])).toEqual([
      [0, false],
      [1, true],
    ])
  })

  it.each(['', 'a', 'You', 'thank you.', 'Am I?'])(
    'drops the hallucination %j before translating',
    async (text) => {
      const h = harness({ transcribe: async () => ({ text, durationS: 1 }) })
      const out = await run(h.deps)
      expect(out.languages[0]!.kind).toBe('silence')
      expect(h.calls.translate).toEqual([])
      expect(h.captions).toEqual([])
    },
  )

  it('drops a "Silence" answer before anything is shown, but not text that merely starts with it', async () => {
    const silent = harness({
      streamTranslation: async function* () {
        yield 'Sil'
        yield 'ence'
      },
    })
    expect((await run(silent.deps)).languages[0]!.kind).toBe('silence')
    expect(silent.captions).toEqual([])
    expect(silent.clips).toEqual([])

    const real = harness({
      streamTranslation: async function* () {
        yield 'Silence '
        yield 'fell over the room.'
      },
    })
    const out = await run(real.deps)
    expect(out.languages[0]!.kind).toBe('speech')
    expect(real.captions.at(-1)!.translated).toBe('Silence fell over the room.')
  })

  it('FALLBACK: a failing STT sends every language to the single path', async () => {
    const h = harness({
      transcribe: async () => {
        throw new SplitStepError('stt', 'timeout')
      },
    })
    const out = await run(
      h.deps,
      new Map([
        ['bn-BD', ['a']],
        ['es-MX', ['b']],
      ]),
    )
    expect(out.sttFailed).toBe(true)
    expect(out.languages.map((l) => [l.kind, l.kind === 'fallback' ? l.step : null])).toEqual([
      ['fallback', 'stt'],
      ['fallback', 'stt'],
    ])
    expect(h.captions).toEqual([])
  })

  it('FALLBACK: translation failing before the first sentence falls back for that language only', async () => {
    const h = harness({
      streamTranslation: async function* (_c, _t, lang) {
        if (lang === 'es-MX') throw new SplitStepError('translate', 'timeout')
        yield 'Fine.'
      },
    })
    const out = await run(
      h.deps,
      new Map([
        ['bn-BD', ['a']],
        ['es-MX', ['b']],
      ]),
    )
    expect(out.languages.map((l) => l.kind)).toEqual(['speech', 'fallback'])
    expect(h.clips.every((c) => c.lang === 'bn-BD')).toBe(true)
  })

  it('FALLBACK: speech failing for the first sentence (both voices) falls back; the caption already shown stays', async () => {
    const h = harness({
      synthesize: async () => {
        throw new SplitStepError('tts', 'timeout')
      },
    })
    const out = await run(h.deps)
    expect(out.languages[0]).toMatchObject({ kind: 'fallback', step: 'tts' })
  })

  it('a sentence whose speech fails later is skipped (caption kept) and reported as audio missing', async () => {
    let n = 0
    const h = harness({
      synthesize: async () => {
        if (++n === 2) throw new SplitStepError('tts', 'timeout') // second sentence, first voice…
        return { audio: MP3, firstByteMs: 1 }
      },
    })
    // second sentence: first voice fails, the other gender answers → still audio
    const out = await run(h.deps)
    expect(out.languages[0]).toMatchObject({ kind: 'speech', clips: 3, voiceFallback: true })
    n = 0
    const two = harness({
      synthesize: async (_c, text) => {
        if (text.startsWith('Second')) throw new SplitStepError('tts', 'timeout')
        return { audio: MP3, firstByteMs: 1 }
      },
    })
    const result = await run(two.deps)
    expect(result.languages[0]).toMatchObject({ kind: 'speech', clips: 2, audioMissing: true })
    // clip numbers count delivered clips only: the listener never waits for a gap
    expect(two.clips.map((c) => [c.seq, c.last])).toEqual([
      [0, false],
      [1, true],
    ])
    expect(two.captions).toHaveLength(3)
  })

  it('uses the other gender when the preferred voice returns no usable audio, and says so', async () => {
    const log = vi.fn()
    const h = harness({
      log,
      synthesize: async (_c, _t, voice) => {
        h.calls.tts.push(voice)
        return voice === 'bn-BD-PradeepNeural'
          ? { audio: new Uint8Array(44), firstByteMs: 1 }
          : { audio: MP3, firstByteMs: 1 }
      },
    })
    const out = await run(h.deps)
    expect(h.calls.tts[0]).toBe('bn-BD-PradeepNeural') // male speaker voice first
    expect(h.calls.tts.slice(1).every((v) => v === 'bn-BD-NabanitaNeural')).toBe(true)
    expect(out.languages[0]).toMatchObject({ kind: 'speech', voiceFallback: true })
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'voice_fallback', voice: 'bn-BD-NabanitaNeural' }),
    )
  })

  it('a partial translation failure after the first sentence keeps what was said', async () => {
    const h = harness({
      streamTranslation: async function* () {
        yield 'Good start. '
        throw new SplitStepError('translate', 'timeout')
      },
    })
    const out = await run(h.deps)
    expect(out.languages[0]).toMatchObject({ kind: 'speech', sentences: 1, clips: 1 })
    expect(h.clips.map((c) => c.last)).toEqual([true])
  })
})
