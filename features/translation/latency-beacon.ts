/**
 * Reports what this browser measured for an utterance to POST /api/latency (server log only,
 * see `pnpm latency:report`). Fire and forget: a failed report is never shown or retried.
 */
export interface LatencyReport {
  sessionId: string
  utteranceId: string
  kind: 'speak' | 'listen'
  lang?: string
  encodeMs?: number
  vadMs?: number
  roundTripMs?: number
  bytes?: number
  format?: 'wav' | 'opus'
  /** speak: whole upload at speech end, or chunks while speaking. */
  mode?: 'whole' | 'chunked'
  /** speak: the network leg (PerformanceResourceTiming) and main-thread long tasks. */
  stalledMs?: number
  waitMs?: number
  downloadMs?: number
  longTasks?: number
  longTaskMs?: number
  captionMs?: number
  audioMs?: number
  fetchMs?: number
  via?: 'url' | 'inline'
  /** listen: the channel the messages arrived over (DELIVERY). */
  delivery?: 'livekit' | 'sse'
}

export function reportLatency(report: LatencyReport): void {
  void fetch('/api/latency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {})
}
