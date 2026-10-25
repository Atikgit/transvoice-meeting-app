/**
 * Latency report from the app's JSON log lines (stdin):
 *
 *   docker logs --since 1h transvoice_meeting_app 2>&1 | pnpm latency:report
 *
 * Reads `{"event":"translate",…}` (server stages, per language and language pair) and
 * `{"event":"latency",…}` (what the browsers measured: speaker encode + round trip, listener
 * speech end → caption / first sound). Other lines are ignored. Prints p50 / p95 / max per stage
 * and per language pair, and checks the targets: speech end → translated audio start p50 ≤ 1.8 s,
 * p95 ≤ 3 s. Listener times compare the speaker's clock with the listener's, so they are only as
 * exact as the devices' clocks; "speech end" is when the speaker really stopped (VAD wait removed).
 * No transcripts, audio, emails or user ids are in the input or the output.
 */
import { pathToFileURL } from 'node:url'

export const TARGET_P50_MS = 1800
export const TARGET_P95_MS = 3000

type Num = number | undefined
interface TranslateLine {
  event: 'translate'
  utteranceId?: string
  intakeMs?: number
  contextMs?: number
  totalMs?: number
  languages?: {
    lang: string
    pair?: string
    outcome: string
    apiMs?: number
    captionMs?: number
    audioMs?: number
  }[]
}
interface LatencyLine {
  event: 'latency'
  utteranceId?: string
  kind: 'speak' | 'listen'
  lang?: string
  encodeMs?: number
  roundTripMs?: number
  captionMs?: number
  audioMs?: number
  fetchMs?: number
  via?: string
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}

class Samples {
  private values: number[] = []
  add(value: Num) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) this.values.push(value)
  }
  stats() {
    const sorted = [...this.values].sort((a, b) => a - b)
    return {
      n: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted.at(-1) ?? NaN,
    }
  }
}

function parseLine(line: string): TranslateLine | LatencyLine | null {
  const start = line.indexOf('{')
  if (start < 0) return null
  try {
    const value = JSON.parse(line.slice(start)) as { event?: string }
    return value.event === 'translate' || value.event === 'latency'
      ? (value as TranslateLine | LatencyLine)
      : null
  } catch {
    return null
  }
}

export interface Stage {
  name: string
  n: number
  p50: number
  p95: number
  max: number
}
export interface Report {
  utterances: number
  stages: Stage[]
  pairs: { pair: string; stages: Stage[] }[]
  verdict: 'pass' | 'fail' | 'no-data'
}

export function buildReport(lines: Iterable<string>): Report {
  const translate: TranslateLine[] = []
  const latency: LatencyLine[] = []
  for (const line of lines) {
    const entry = parseLine(line)
    if (entry?.event === 'translate') translate.push(entry)
    else if (entry?.event === 'latency') latency.push(entry)
  }

  const overall = new Map<string, Samples>()
  const byPair = new Map<string, Map<string, Samples>>()
  const sample = (name: string, value: Num, pair?: string) => {
    if (!overall.has(name)) overall.set(name, new Samples())
    overall.get(name)!.add(value)
    if (pair) {
      if (!byPair.has(pair)) byPair.set(pair, new Map())
      const stages = byPair.get(pair)!
      if (!stages.has(name)) stages.set(name, new Samples())
      stages.get(name)!.add(value)
    }
  }

  const byUtterance = new Map<string, TranslateLine>()
  for (const t of translate) {
    if (t.utteranceId) byUtterance.set(t.utteranceId, t)
    sample('server: intake (auth, upload)', t.intakeMs)
    sample('server: context (db + livekit)', t.contextMs)
    sample('server: total', t.totalMs)
    for (const l of t.languages ?? []) {
      if (l.outcome !== 'speech') continue
      sample('server: API call per language', l.apiMs, l.pair)
      sample('server: API result → caption sent', l.captionMs, l.pair)
      sample('server: API result → audio sent', l.audioMs, l.pair)
    }
  }
  for (const l of latency) {
    const server = l.utteranceId ? byUtterance.get(l.utteranceId) : undefined
    if (l.kind === 'speak') {
      sample('speaker: WAV encode', l.encodeMs)
      sample('speaker: upload → answer (round trip)', l.roundTripMs)
      if (l.roundTripMs !== undefined && server?.totalMs !== undefined) {
        sample('network: round trip − server total', Math.max(0, l.roundTripMs - server.totalMs))
      }
    } else {
      const pair =
        server?.languages?.find((x) => x.lang === l.lang)?.pair ??
        (l.lang ? `?>${l.lang}` : undefined)
      sample('listener: clip fetch + decode', l.fetchMs, pair)
      sample('listener: speech end → caption shown', l.captionMs, pair)
      sample('listener: speech end → audio start', l.audioMs, pair)
    }
  }

  const toStages = (map: Map<string, Samples>): Stage[] =>
    [...map]
      .map(([name, s]) => ({ name, ...s.stats() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  const end = overall.get('listener: speech end → audio start')?.stats()
  return {
    utterances: translate.length,
    stages: toStages(overall),
    pairs: [...byPair]
      .map(([pair, stages]) => ({ pair, stages: toStages(stages) }))
      .sort((a, b) => a.pair.localeCompare(b.pair)),
    verdict:
      !end || end.n === 0
        ? 'no-data'
        : end.p50 <= TARGET_P50_MS && end.p95 <= TARGET_P95_MS
          ? 'pass'
          : 'fail',
  }
}

const fmt = (n: number) => (Number.isNaN(n) ? '—' : String(Math.round(n))).padStart(6)

export function formatReport(report: Report): string {
  const table = (stages: Stage[]) =>
    stages
      .map(
        (s) =>
          `  ${s.name.padEnd(42)} n=${String(s.n).padStart(4)}  p50 ${fmt(s.p50)} ms  p95 ${fmt(s.p95)} ms  max ${fmt(s.max)} ms`,
      )
      .join('\n')
  const out = [`Utterances in the log: ${report.utterances}`, '', table(report.stages)]
  for (const { pair, stages } of report.pairs) out.push('', `Language pair ${pair}`, table(stages))
  out.push(
    '',
    report.verdict === 'no-data'
      ? `Target (speech end → audio start, p50 ≤ ${TARGET_P50_MS} ms, p95 ≤ ${TARGET_P95_MS} ms): no listener measurements in this log.`
      : `Target (speech end → audio start, p50 ≤ ${TARGET_P50_MS} ms, p95 ≤ ${TARGET_P95_MS} ms): ${report.verdict.toUpperCase()}`,
  )
  return out.join('\n')
}

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const report = buildReport(Buffer.concat(chunks).toString('utf8').split('\n'))
  console.log(formatReport(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
