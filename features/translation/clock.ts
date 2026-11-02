/**
 * This browser's clock offset to the server's, estimated once per page load from 5 pings of
 * GET /api/time: for each, offset = serverTime - (sent + roundTrip / 2); the ping with the lowest
 * round trip is the most trustworthy and wins. serverNow() is then comparable between devices
 * (to within about half the best round trip), which the speaker's "speech ended at" and the
 * listener's "audio started at" need.
 */
export const PINGS = 5

export interface Ping {
  /** Local clock (ms) when the request was sent / the answer arrived. */
  sentAt: number
  receivedAt: number
  /** The server's clock (ms) in the answer. */
  serverTime: number
}

/** Offset (server − local, ms) from the ping with the lowest round trip; 0 without pings. */
export function offsetFromPings(pings: Ping[]): number {
  let best: { rtt: number; offset: number } | null = null
  for (const p of pings) {
    const rtt = p.receivedAt - p.sentAt
    if (rtt < 0) continue
    if (!best || rtt < best.rtt) best = { rtt, offset: p.serverTime - (p.sentAt + rtt / 2) }
  }
  return best ? Math.round(best.offset) : 0
}

let offsetMs = 0
let synced: Promise<number> | null = null

/** The current time on the server's clock (ms since epoch). */
export function serverNow(): number {
  return Date.now() + offsetMs
}

export function clockOffset(): number {
  return offsetMs
}

/** Pings the server (once per page load; later calls share the result). Never throws. */
export function syncServerClock(
  ping: () => Promise<number> = async () => {
    const res = await fetch('/api/time', { cache: 'no-store' })
    return ((await res.json()) as { t: number }).t
  },
  now: () => number = Date.now,
): Promise<number> {
  synced ??= (async () => {
    const pings: Ping[] = []
    for (let i = 0; i < PINGS; i++) {
      try {
        const sentAt = now()
        const serverTime = await ping()
        pings.push({ sentAt, receivedAt: now(), serverTime })
      } catch {
        // a lost ping is just one sample less
      }
    }
    offsetMs = offsetFromPings(pings)
    return offsetMs
  })()
  return synced
}

export function resetClockForTests() {
  offsetMs = 0
  synced = null
}
