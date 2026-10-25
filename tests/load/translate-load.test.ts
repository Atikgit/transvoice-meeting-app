import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeWav } from '@/lib/translation/wav'

/**
 * Load test for the server side of /api/translate: 8 participants, 3 languages.
 *
 * What runs for real: the per-language fan-out (lib/translation/fanout.ts), the TransVoice HTTP
 * client with its retry and timeout, JSON of production size (a 3 s WAV in, a TTS clip out),
 * and the circuit breaker. What is stubbed: the TransVoice API (a local HTTP server with
 * synthetic latency), Supabase (the context is a fixed object) and LiveKit (delivery is a few ms).
 * So the numbers show what our code adds on top of the API; they are not an end-to-end measure.
 *
 *   pnpm load:translate        LOAD_SECONDS=60 LOAD_MOCK_BASE_MS=400 pnpm load:translate
 */
const SECONDS = Number(process.env.LOAD_SECONDS ?? 20)
const MOCK_BASE_MS = Number(process.env.LOAD_MOCK_BASE_MS ?? 300)
const MOCK_EXTRA_MEAN_MS = Number(process.env.LOAD_MOCK_EXTRA_MS ?? 150) // exponential tail
const MEAN_GAP_S = Number(process.env.LOAD_MEAN_GAP_S ?? 8) // between one speaker's utterances
const BURST_ROUNDS = Number(process.env.LOAD_BURST_ROUNDS ?? 10)
const DELIVERY_MS = 3

const PARTICIPANTS = [
  ...[1, 2, 3].map((n) => ({ userId: `bn-${n}`, lang: 'bn-BD' })),
  ...[1, 2, 3].map((n) => ({ userId: `en-${n}`, lang: 'en-US' })),
  ...[1, 2].map((n) => ({ userId: `es-${n}`, lang: 'es-ES' })),
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : 0

let server: Server
const apiDelays = new Map<string, number[]>() // utterance → mock latency per request
const TTS = 'U'.repeat(60_000) // ≈ 45 KB of TTS audio, base64

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { session_id?: string }
      const delay = MOCK_BASE_MS + -Math.log(1 - Math.random()) * MOCK_EXTRA_MEAN_MS
      const key = body.session_id ?? ''
      apiDelays.set(key, [...(apiDelays.get(key) ?? []), delay])
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({ original_text: 'হ্যালো', translated_text: 'Hello', tts_audio: TTS }),
        )
      }, delay)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.TRANSVOICE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

interface Sample {
  totalMs: number
  overheadMs: number
  languageMs: number[]
  failed: number
  languages: number
}

async function utterance(speaker: (typeof PARTICIPANTS)[number], id: string): Promise<Sample> {
  const { groupListeners, translateForListeners } = await import('@/lib/translation/fanout')
  const { CircuitBreaker } = await import('@/lib/translation/breaker')
  const groups = groupListeners(
    PARTICIPANTS.filter((p) => p.userId !== speaker.userId).map((p) => ({
      userId: p.userId,
      listenLang: p.lang,
    })),
    speaker.lang,
  )
  const audio = Buffer.from(encodeWav(new Float32Array(16_000 * 3).fill(0.2))).toString('base64')
  const started = performance.now()
  const results = await translateForListeners({
    audioBase64: audio,
    spokenLang: speaker.lang,
    voiceGender: 'female',
    groups,
    sessionId: id,
    speakerId: speaker.userId,
    breaker: new CircuitBreaker(Infinity), // measure the pipeline, not breaker trips
    onResult: () => sleep(DELIVERY_MS),
  })
  const totalMs = performance.now() - started
  const delays = apiDelays.get(id) ?? []
  return {
    totalMs,
    overheadMs: totalMs - Math.max(0, ...delays) - DELIVERY_MS,
    languageMs: results.map((r) => r.ms),
    failed: results.filter((r) => r.kind === 'failed').length,
    languages: results.length,
  }
}

function report(title: string, samples: Sample[], loop: ReturnType<typeof monitorEventLoopDelay>) {
  const total = samples.map((s) => s.totalMs).sort((a, b) => a - b)
  const overhead = samples.map((s) => s.overheadMs).sort((a, b) => a - b)
  const language = samples.flatMap((s) => s.languageMs).sort((a, b) => a - b)
  const row = (name: string, v: number[]) =>
    `  ${name.padEnd(34)} p50 ${percentile(v, 50).toFixed(0).padStart(5)} ms   p95 ${percentile(v, 95).toFixed(0).padStart(5)} ms   max ${(v.at(-1) ?? 0).toFixed(0).padStart(5)} ms`
  console.log(
    [
      `\n${title}: ${samples.length} utterances, ${language.length} API calls, ${samples.reduce((n, s) => n + s.failed, 0)} failed`,
      row('utterance (slowest language)', total),
      row('per language call', language),
      row('our overhead (utterance − API)', overhead),
      `  event-loop delay                   p50 ${(loop.percentile(50) / 1e6).toFixed(1).padStart(5)} ms   p95 ${(loop.percentile(95) / 1e6).toFixed(1).padStart(5)} ms   max ${(loop.max / 1e6).toFixed(1).padStart(5)} ms`,
    ].join('\n'),
  )
}

describe('/api/translate fan-out under load', () => {
  it(`conversation: 8 speakers, one utterance every ~${MEAN_GAP_S} s each, ${SECONDS} s`, async () => {
    const samples: Sample[] = []
    const loop = monitorEventLoopDelay()
    loop.enable()
    const end = Date.now() + SECONDS * 1000
    let n = 0
    await Promise.all(
      PARTICIPANTS.map(async (speaker) => {
        await sleep(Math.random() * MEAN_GAP_S * 1000)
        while (Date.now() < end) {
          samples.push(await utterance(speaker, `conv-${++n}`))
          await sleep(
            Math.min(
              -Math.log(1 - Math.random()) * MEAN_GAP_S * 1000,
              Math.max(0, end - Date.now()),
            ),
          )
        }
      }),
    )
    loop.disable()
    report('Conversation', samples, loop)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.reduce((n, s) => n + s.failed, 0)).toBe(0)
    expect(
      percentile(
        samples.map((s) => s.overheadMs).sort((a, b) => a - b),
        95,
      ),
    ).toBeLessThan(250)
  })

  it(`worst case: all 8 speak at the same instant, ${BURST_ROUNDS} times`, async () => {
    const samples: Sample[] = []
    const loop = monitorEventLoopDelay()
    loop.enable()
    for (let round = 0; round < BURST_ROUNDS; round++) {
      samples.push(
        ...(await Promise.all(PARTICIPANTS.map((p, i) => utterance(p, `burst-${round}-${i}`)))),
      )
    }
    loop.disable()
    report('Burst (8 simultaneous speakers)', samples, loop)
    expect(samples.reduce((n, s) => n + s.failed, 0)).toBe(0)
    expect(
      percentile(
        samples.map((s) => s.overheadMs).sort((a, b) => a - b),
        95,
      ),
    ).toBeLessThan(500)
  })
})
