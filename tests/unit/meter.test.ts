import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))

const { meterTickOnce, resetMeterState, startMeterTimer, stopMeterTimer } =
  await import('@/lib/billing/meter')
const { serverEnv } = await import('@/lib/env')

const SECRET = 'x'.repeat(40)
let info: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetMeterState()
  rpc.mockReset()
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const deps = (tickResult: Record<string, unknown>) => ({
  basis: 'per_payer',
  multiplier: true,
  configure: vi.fn(async () => {}),
  tick: vi.fn(async () => tickResult),
})

describe('meterTickOnce', () => {
  it('logs one counts-only JSON line when something was billed', async () => {
    const d = deps({
      skipped: false,
      buckets: 3,
      rows: 3,
      minutes_debited: 3,
      payers_touched: 1,
      payers_depleted: 0,
      basis: 'per_payer',
      already_billed: 0,
    })
    const summary = await meterTickOnce('timer', d)
    expect(summary).toMatchObject({ rows: 3, minutesDebited: 3, payersTouched: 1 })
    expect(info).toHaveBeenCalledTimes(1)
    const line = JSON.parse(String(info.mock.calls[0]![0]))
    expect(line).toMatchObject({ event: 'meter_tick', source: 'timer', rows: 3, minutesDebited: 3 })
    expect(Object.keys(line).join()).not.toMatch(/user|payer_id|session|email/i)
  })

  it('stays quiet for an idle minute but reports a skipped (locked) run', async () => {
    await meterTickOnce('timer', deps({ skipped: false, buckets: 1, rows: 0 }))
    expect(info).not.toHaveBeenCalled()
    await meterTickOnce('timer', deps({ skipped: true, reason: 'locked' }))
    expect(JSON.parse(String(info.mock.calls[0]![0]))).toMatchObject({
      skipped: true,
      reason: 'locked',
    })
  })

  it('copies the billing settings into the database once, again after a failure', async () => {
    const d = deps({ skipped: false, rows: 0 })
    await meterTickOnce('timer', d)
    await meterTickOnce('timer', d)
    expect(d.configure).toHaveBeenCalledTimes(1)
    expect(d.configure).toHaveBeenCalledWith('per_payer', true)
    d.tick.mockRejectedValueOnce(new Error('db down'))
    await expect(meterTickOnce('timer', d)).rejects.toThrow('db down')
    await meterTickOnce('timer', d)
    expect(d.configure).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({
      event: 'meter_tick_failed',
    })
  })
})

describe('startMeterTimer', () => {
  it('ticks at once and every interval (1 + 3 in 3 minutes), never overlapping a slow run', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const d = deps({ skipped: false, rows: 0 })
    d.tick.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ skipped: false, rows: 0 }))),
    )
    startMeterTimer(d, 60_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000) // the first run is still going: skipped
    expect(d.tick).toHaveBeenCalledTimes(1)
    release?.()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(d.tick).toHaveBeenCalledTimes(3)
    stopMeterTimer()
  })

  it('does nothing with a zero interval', () => {
    const d = deps({})
    startMeterTimer(d, 0)
    expect(d.tick).not.toHaveBeenCalled()
  })
})

describe('POST /api/internal/meter-tick', () => {
  const call = async (headers: Record<string, string>) => {
    const { POST } = await import('@/app/api/internal/meter-tick/route')
    return POST(
      new NextRequest('https://meet.transvoice.ai/api/internal/meter-tick', {
        method: 'POST',
        headers,
      }),
    )
  }

  it('rejects a missing or wrong secret, runs the tick with the right one', async () => {
    const original = process.env.CRON_SECRET
    process.env.CRON_SECRET = SECRET
    rpc.mockImplementation(async (fn: string) =>
      fn === 'apply_minute_tick'
        ? { data: { skipped: false, buckets: 2, rows: 2, minutes_debited: 2 }, error: null }
        : { data: null, error: null },
    )
    try {
      expect((await call({})).status).toBe(401)
      expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401)
      expect(rpc).not.toHaveBeenCalledWith('apply_minute_tick')
      const ok = await call({ authorization: `Bearer ${SECRET}` })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ rows: 2, minutesDebited: 2 })
      expect(rpc).toHaveBeenCalledWith('apply_minute_tick')
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = original
    }
  })

  it('503 when CRON_SECRET is not configured', async () => {
    const original = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(503)
    } finally {
      if (original !== undefined) process.env.CRON_SECRET = original
    }
  })
})

describe('env', () => {
  it('BILLING_BASIS defaults to per_payer and METER_TICK_SEC to 60', () => {
    expect(serverEnv()).toMatchObject({ BILLING_BASIS: 'per_payer', METER_TICK_SEC: 60 })
  })
})
