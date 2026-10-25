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
  roundTripMs?: number
  bytes?: number
  captionMs?: number
  audioMs?: number
  fetchMs?: number
  via?: 'url' | 'inline'
}

export function reportLatency(report: LatencyReport): void {
  void fetch('/api/latency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {})
}
