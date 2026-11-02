import { beforeEach, describe, expect, it } from 'vitest'
import { LatencyTracker } from '@/features/translation/metrics'
import {
  clockOffset,
  offsetFromPings,
  PINGS,
  resetClockForTests,
  serverNow,
  syncServerClock,
} from '@/features/translation/clock'
import { GET } from '@/app/api/time/route'

beforeEach(resetClockForTests)

describe('offsetFromPings', () => {
  it('trusts the ping with the lowest round trip', () => {
    // Local clock is 5000 ms behind the server. A slow ping (rtt 800) would say 5000 - 400 + 400…
    const pings = [
      { sentAt: 1000, receivedAt: 1800, serverTime: 1000 + 5000 + 700 }, // asymmetric slow ping
      { sentAt: 2000, receivedAt: 2040, serverTime: 2000 + 5000 + 20 }, // rtt 40: exact
      { sentAt: 3000, receivedAt: 3300, serverTime: 3000 + 5000 + 150 },
    ]
    expect(offsetFromPings(pings)).toBe(5000)
  })
  it('is 0 without usable pings', () => {
    expect(offsetFromPings([])).toBe(0)
    expect(offsetFromPings([{ sentAt: 10, receivedAt: 5, serverTime: 1 }])).toBe(0)
  })
})

describe('syncServerClock', () => {
  it('pings 5 times at join, applies the offset to serverNow(), and syncs once per page', async () => {
    let local = 1_000_000
    const OFFSET = -7_300 // this device is 7.3 s behind the server
    let calls = 0
    const rtts = [90, 30, 200, 60, 120]
    const ping = async () => {
      const rtt = rtts[calls++]!
      local += rtt / 2
      const serverTime = local + OFFSET * -1
      local += rtt / 2
      return serverTime
    }
    const offset = await syncServerClock(ping, () => local)
    expect(calls).toBe(PINGS)
    expect(Math.abs(offset - 7300)).toBeLessThanOrEqual(1)
    expect(clockOffset()).toBe(offset)
    expect(Math.abs(serverNow() - (Date.now() + 7300))).toBeLessThan(5)
    await syncServerClock(ping, () => local)
    expect(calls).toBe(PINGS) // not again
  })

  it('survives lost pings', async () => {
    let n = 0
    const offset = await syncServerClock(
      async () => {
        if (n++ < 4) throw new Error('offline')
        return 50
      },
      () => 0,
    )
    expect(Number.isFinite(offset)).toBe(true)
  })
})

describe('the metric with two devices whose clocks differ', () => {
  it('uses server time on both sides, so the 8 s skew disappears', () => {
    // Real timeline (server clock): speech ends at T, audio starts 1.7 s later.
    const T = 10_000_000
    const speakerOffset = +3000 // speaker's clock is 3 s behind the server
    const listenerOffset = -5000 // listener's clock is 5 s ahead
    const speakerLocalEnd = T - speakerOffset
    const listenerLocalStart = T + 1700 - listenerOffset

    const raw = new LatencyTracker()
    raw.audioStarted('u', speakerLocalEnd, listenerLocalStart) // before: clocks mixed
    expect(raw.get('u')!.audioMs).toBe(1700 + 3000 + 5000) // 9.7 s: the inflated number

    const fixed = new LatencyTracker()
    const clientTs = speakerLocalEnd + speakerOffset // speaker sends server time
    fixed.audioStarted('u', clientTs, listenerLocalStart + listenerOffset)
    expect(fixed.get('u')!.audioMs).toBe(1700)
  })
})

describe('GET /api/time', () => {
  it('answers the server clock, uncached', async () => {
    const before = Date.now()
    const res = GET()
    const body = (await res.json()) as { t: number }
    expect(body.t).toBeGreaterThanOrEqual(before)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
