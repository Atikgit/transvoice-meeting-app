import { describe, expect, it } from 'vitest'
import { buildReport, formatReport, percentile, TARGET_P50_MS } from '../../scripts/latency-report'

const translate = (id: string, apiMs: number, pair = 'bn-BD>en-US') =>
  JSON.stringify({
    event: 'translate',
    sessionId: 's',
    utteranceId: id,
    intakeMs: 10,
    contextMs: 30,
    totalMs: apiMs + 50,
    languages: [
      { lang: pair.split('>')[1], pair, outcome: 'speech', apiMs, captionMs: 2, audioMs: 5 },
    ],
  })
const listen = (id: string, audioMs: number, lang = 'en-US') =>
  JSON.stringify({
    event: 'latency',
    sessionId: 's',
    utteranceId: id,
    kind: 'listen',
    lang,
    audioMs,
    captionMs: audioMs - 200,
    fetchMs: 80,
  })
const speak = (id: string, roundTripMs: number) =>
  JSON.stringify({
    event: 'latency',
    sessionId: 's',
    utteranceId: id,
    kind: 'speak',
    encodeMs: 5,
    roundTripMs,
  })

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(v, 50)).toBe(5)
    expect(percentile(v, 95)).toBe(10)
    expect(percentile([7], 95)).toBe(7)
    expect(percentile([], 50)).toBeNaN()
  })
})

describe('buildReport', () => {
  it('ignores noise, strips docker prefixes, and computes p50/p95 per stage and per pair', () => {
    const lines = [
      'garbage',
      '{"event":"other"}',
      '2026-10-26T10:00:00.000Z ' + translate('a', 800),
      translate('b', 900),
      translate('c', 1000, 'en-US>es-ES'),
      listen('a', 1500),
      listen('b', 1700),
      listen('c', 2400, 'es-ES'),
      speak('a', 1000),
    ]
    const report = buildReport(lines)
    const stage = (name: string) => report.stages.find((s) => s.name === name)!
    expect(report.utterances).toBe(3)
    expect(stage('server: API call per language')).toMatchObject({ n: 3, p50: 900, p95: 1000 })
    expect(stage('listener: speech end → audio start')).toMatchObject({
      n: 3,
      p50: 1700,
      p95: 2400,
    })
    // 1000 ms round trip − 850 ms server total for utterance "a"
    expect(stage('network: round trip − server total')).toMatchObject({ n: 1, p50: 150 })
    expect(report.pairs.map((p) => p.pair)).toEqual(['bn-BD>en-US', 'en-US>es-ES'])
    expect(
      report.pairs[1]!.stages.find((s) => s.name === 'listener: speech end → audio start'),
    ).toMatchObject({ n: 1, p50: 2400 })
  })

  it('judges the targets (p50 ≤ 1.8 s, p95 ≤ 3 s) only from listener measurements', () => {
    const pass = buildReport([translate('a', 800), listen('a', 1500), listen('b', 1800)])
    expect(pass.verdict).toBe('pass')
    const slowMedian = buildReport([listen('a', TARGET_P50_MS + 1)])
    expect(slowMedian.verdict).toBe('fail')
    const slowTail = buildReport([
      ...Array.from({ length: 19 }, (_, i) => listen(`x${i}`, 1000)),
      listen('y', 3500),
      listen('z', 3500),
    ])
    expect(slowTail.verdict).toBe('fail')
    expect(buildReport([translate('a', 800)]).verdict).toBe('no-data')
  })

  it('prints a readable table and never claims numbers without data', () => {
    expect(formatReport(buildReport([]))).toContain('no listener measurements')
    expect(formatReport(buildReport([listen('a', 1000)]))).toContain('PASS')
  })
})

describe('API stage timings and upload format', () => {
  it('reports asr_ms / mt_ms / tts_ms only when the API sends them, and splits round trips by upload format', () => {
    const withTimings = JSON.stringify({
      event: 'translate',
      utteranceId: 'a',
      totalMs: 2000,
      languages: [
        {
          lang: 'en-US',
          pair: 'bn-BD>en-US',
          outcome: 'speech',
          apiMs: 1800,
          asrMs: 700,
          mtMs: 300,
          ttsMs: 600,
        },
      ],
    })
    const without = translate('b', 1500)
    const speakOpus = JSON.stringify({
      event: 'latency',
      utteranceId: 'a',
      kind: 'speak',
      encodeMs: 20,
      vadMs: 400,
      roundTripMs: 2100,
      bytes: 9000,
      format: 'opus',
    })
    const report = buildReport([withTimings, without, speakOpus])
    const stage = (name: string) => report.stages.find((s) => s.name === name)
    expect(stage('API: speech recognition (asr_ms)')).toMatchObject({ n: 1, p50: 700 })
    expect(stage('API: translation (mt_ms)')).toMatchObject({ n: 1, p50: 300 })
    expect(stage('API: speech synthesis (tts_ms)')).toMatchObject({ n: 1, p50: 600 })
    expect(stage('server: API call per language')).toMatchObject({ n: 2 })
    expect(stage('speaker: round trip [opus]')).toMatchObject({ n: 1, p50: 2100 })
    expect(stage('speaker: upload size bytes [opus]')).toMatchObject({ p50: 9000 })
    expect(stage('speaker: VAD end-of-speech wait')).toMatchObject({ p50: 400 })
  })
})

describe('single vs split side by side', () => {
  it('collects server stages per pipeline and prints both columns, counting fallbacks', () => {
    const line = (id: string, language: object) =>
      JSON.stringify({ event: 'translate', utteranceId: id, totalMs: 100, languages: [language] })
    const report = buildReport([
      line('a', {
        lang: 'bn-BD',
        pair: 'en-US>bn-BD',
        outcome: 'speech',
        pipeline: 'single',
        apiMs: 2500,
        audioMs: 10,
        toFirstAudioMs: 2900,
      }),
      line('b', {
        lang: 'bn-BD',
        pair: 'en-US>bn-BD',
        outcome: 'speech',
        pipeline: 'split',
        sttMs: 400,
        translateFirstTokenMs: 250,
        firstSentenceMs: 600,
        ttsFirstByteMs: 350,
        toFirstAudioMs: 1500,
      }),
      line('c', {
        lang: 'bn-BD',
        pair: 'en-US>bn-BD',
        outcome: 'speech',
        pipeline: 'single',
        fallback: 'stt',
        apiMs: 2600,
        audioMs: 10,
        toFirstAudioMs: 7000,
      }),
    ])
    expect(report.fallbacks).toBe(1)
    const stage = (p: string, name: string) =>
      report.pipelines.find((x) => x.pipeline === p)!.stages.find((s) => s.name === name)
    expect(stage('split', 'request → first audio sent')).toMatchObject({ n: 1, p50: 1500 })
    expect(stage('split', 'stt (stt_ms)')).toMatchObject({ p50: 400 })
    expect(stage('single', 'request → first audio sent')).toMatchObject({ n: 2 })
    const text = formatReport(report)
    expect(text).toContain('Single vs split')
    expect(text).toContain('split runs that fell back to the single call: 1')
  })

  it('splits the listener numbers by delivery channel (livekit vs sse) and by clip route (inline vs url)', () => {
    const l = (id: string, audioMs: number, delivery: string, via: string, fetchMs: number) =>
      JSON.stringify({
        event: 'latency',
        sessionId: 's',
        utteranceId: id,
        kind: 'listen',
        lang: 'en-US',
        audioMs,
        captionMs: audioMs - 300,
        fetchMs,
        via,
        delivery,
      })
    const report = buildReport([
      l('a', 3000, 'livekit', 'url', 550),
      l('b', 2000, 'sse', 'inline', 6),
    ])
    const stage = (name: string) => report.stages.find((s) => s.name === name)
    expect(stage('listener: speech end → audio start [livekit]')?.p50).toBe(3000)
    expect(stage('listener: speech end → audio start [sse]')?.p50).toBe(2000)
    expect(stage('listener: clip fetch + decode [url]')?.p50).toBe(550)
    expect(stage('listener: clip fetch + decode [inline]')?.p50).toBe(6)
  })

  it('compares upload modes and VAD end-silence settings on speech end -> answer', () => {
    const sp = (id: string, mode: string, silence: number, vadMs: number, roundTripMs: number) =>
      JSON.stringify({
        event: 'latency',
        sessionId: 's',
        utteranceId: id,
        kind: 'speak',
        mode,
        endSilenceMs: silence,
        vadMs,
        roundTripMs,
      })
    const report = buildReport([
      sp('a', 'whole', 400, 430, 2600),
      sp('b', 'chunked', 300, 330, 1900),
    ])
    const p50 = (name: string) => report.stages.find((s) => s.name === name)?.p50
    expect(p50('speaker: speech end → answer, upload whole, end silence 400 ms')).toBe(3030)
    expect(p50('speaker: speech end → answer, upload chunked, end silence 300 ms')).toBe(2230)
  })
})

describe('per client country', () => {
  const beacon = (kind: 'speak' | 'listen', country: string | undefined, ms: number, id = 'u') =>
    JSON.stringify({
      event: 'latency',
      sessionId: 's',
      utteranceId: id,
      kind,
      lang: 'en-US',
      ...(country ? { country } : {}),
      ...(kind === 'listen'
        ? { audioMs: ms, captionMs: ms - 300, fetchMs: 20 }
        : { vadMs: 400, roundTripMs: ms }),
    })

  it('prints p50 / p95 per country for what browsers measured; lines without a country are "unknown"', () => {
    const lines = [
      ...[2000, 2400, 2800, 3200].map((ms, i) => beacon('listen', 'BD', ms, `a${i}`)),
      ...[900, 1000, 1100, 1200].map((ms, i) => beacon('listen', 'DE', ms, `b${i}`)),
      beacon('listen', undefined, 1500, 'c'),
      beacon('listen', 'xx; drop table', 5000, 'd'), // not a country code
      beacon('speak', 'BD', 1600, 'e'),
    ]
    const report = buildReport(lines)
    expect(report.countries.map((c) => c.country)).toEqual(['BD', 'DE', 'unknown'])
    const audio = (country: string) =>
      report.countries
        .find((c) => c.country === country)!
        .stages.find((s) => s.name === 'listener: speech end → audio start')!
    expect(audio('BD')).toMatchObject({ n: 4, p50: 2400, p95: 3200 })
    expect(audio('DE')).toMatchObject({ n: 4, p50: 1000, p95: 1200 })
    expect(audio('unknown')).toMatchObject({ n: 2, p50: 1500, p95: 5000 })
    const bd = report.countries.find((c) => c.country === 'BD')!
    expect(bd.stages.find((s) => s.name === 'speaker: speech end → answer')).toMatchObject({
      n: 1,
      p50: 2000, // 400 ms VAD wait + 1600 ms round trip
    })
    const text = formatReport(report)
    expect(text).toContain('Client country BD')
    expect(text).toMatch(
      /Client country DE[\s\S]*listener: speech end → audio start +n= +4 +p50 +1000 ms +p95 +1200 ms/,
    )
  })

  it('no country data → no country sections', () => {
    expect(buildReport([translate('x', 500)]).countries).toEqual([])
  })
})
