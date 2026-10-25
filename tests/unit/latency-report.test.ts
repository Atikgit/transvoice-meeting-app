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
