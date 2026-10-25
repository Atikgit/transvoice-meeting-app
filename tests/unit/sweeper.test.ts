import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraceDeps } from '@/lib/livekit/grace'
import { startSweeper, stopSweeper, sweepOnce, sweeperRunning, type SweepDeps } from '@/lib/sweeper'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function grace(overrides: Partial<GraceDeps> = {}): GraceDeps {
  return {
    graceMs: 60_000,
    loadSession: vi.fn(async () => ({ status: 'live', hostId: 'host-1' })),
    connectedIdentities: vi.fn(async () => []),
    endSession: vi.fn(async () => true),
    publishEnded: vi.fn(async () => {}),
    ...overrides,
  }
}

function deps(overrides: Partial<SweepDeps> = {}): SweepDeps {
  return {
    graceMs: 60_000,
    grace: grace(),
    sweepOrphans: vi.fn(async () => ({ segmentsClosed: 2, ringingExpired: 1 })),
    staleSessions: vi.fn(async () => [A, B]),
    ...overrides,
  }
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(async () => {
  await stopSweeper(0)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sweeper', () => {
  it('ends abandoned open sessions and reports the orphan counts', async () => {
    const d = deps()
    const result = await sweepOnce(d)
    expect(d.staleSessions).toHaveBeenCalledWith(60_000)
    expect(d.grace.endSession).toHaveBeenCalledWith(A, 'reconnect_timeout')
    expect(d.grace.endSession).toHaveBeenCalledWith(B, 'reconnect_timeout')
    expect(result).toEqual({
      segmentsClosed: 2,
      ringingExpired: 1,
      sessionsChecked: 2,
      sessionsEnded: 2,
      failed: 0,
    })
  })

  it('leaves a session whose host is still in the room', async () => {
    const d = deps({
      grace: grace({ connectedIdentities: vi.fn(async () => ['host-1']) }),
    })
    const result = await sweepOnce(d)
    expect(d.grace.endSession).not.toHaveBeenCalled()
    expect(result.sessionsEnded).toBe(0)
  })

  it('keeps going when LiveKit fails for one session, and counts the failure', async () => {
    const connectedIdentities = vi
      .fn<GraceDeps['connectedIdentities']>()
      .mockRejectedValueOnce(new Error('livekit down'))
      .mockResolvedValue([])
    const result = await sweepOnce(deps({ grace: grace({ connectedIdentities }) }))
    expect(result).toMatchObject({ sessionsChecked: 2, sessionsEnded: 1, failed: 1 })
  })

  it('still checks sessions when the orphan cleanup fails', async () => {
    const d = deps({ sweepOrphans: vi.fn(async () => Promise.reject(new Error('db'))) })
    const result = await sweepOnce(d)
    expect(result).toMatchObject({ sessionsEnded: 2, failed: 1 })
  })

  it('runs at start and on every interval, never overlapping, and stops cleanly', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const sweepOrphans = vi
      .fn<SweepDeps['sweepOrphans']>()
      .mockImplementationOnce(async () => {
        await slow
        return { segmentsClosed: 0, ringingExpired: 0 }
      })
      .mockResolvedValue({ segmentsClosed: 0, ringingExpired: 0 })
    startSweeper(deps({ sweepOrphans, staleSessions: vi.fn(async () => []) }), 1000)
    expect(sweeperRunning()).toBe(true)
    expect(sweepOrphans).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000) // first run still in progress: ticks are skipped
    expect(sweepOrphans).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sweepOrphans).toHaveBeenCalledTimes(2)
    await stopSweeper()
    expect(sweeperRunning()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sweepOrphans).toHaveBeenCalledTimes(2)
  })
})
