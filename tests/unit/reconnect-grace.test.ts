import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkAfterGrace,
  pendingGraceChecks,
  scheduleGraceCheck,
  type GraceDeps,
} from '@/lib/livekit/grace'

const SESSION = '22222222-2222-4222-8222-222222222222'

function deps(overrides: Partial<GraceDeps> = {}): GraceDeps {
  return {
    graceMs: 60_000,
    loadSession: vi.fn(async () => ({ status: 'live', hostId: 'host-1' })),
    connectedIdentities: vi.fn(async () => ['guest-1']),
    endSession: vi.fn(async () => true),
    publishEnded: vi.fn(async () => {}),
    ...overrides,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('reconnect grace (Rule 5)', () => {
  it('ends a live session whose host did not come back, with reconnect_timeout', async () => {
    const d = deps()
    expect(await checkAfterGrace(SESSION, d)).toBe('ended')
    expect(d.endSession).toHaveBeenCalledWith(SESSION, 'reconnect_timeout')
    expect(d.publishEnded).toHaveBeenCalledWith(SESSION, 'host-1', 'reconnect_timeout')
  })

  it('keeps the session when the host reconnected in time', async () => {
    const d = deps({ connectedIdentities: vi.fn(async () => ['host-1', 'guest-1']) })
    expect(await checkAfterGrace(SESSION, d)).toBe('recovered')
    expect(d.endSession).not.toHaveBeenCalled()
  })

  it('ends a session nobody is left in; closes an abandoned ready session', async () => {
    const empty = deps({ connectedIdentities: vi.fn(async () => []) })
    expect(await checkAfterGrace(SESSION, empty)).toBe('ended')
    const ready = deps({
      loadSession: vi.fn(async () => ({ status: 'ready', hostId: 'host-1' })),
      connectedIdentities: vi.fn(async () => []),
    })
    await checkAfterGrace(SESSION, ready)
    expect(ready.endSession).toHaveBeenCalledWith(SESSION, 'abandoned')
  })

  it('a ready session with the guest still waiting stays open', async () => {
    const d = deps({ loadSession: vi.fn(async () => ({ status: 'ready', hostId: 'host-1' })) })
    expect(await checkAfterGrace(SESSION, d)).toBe('recovered')
  })

  it('ignores sessions that already ended', async () => {
    const d = deps({ loadSession: vi.fn(async () => ({ status: 'ended', hostId: 'host-1' })) })
    expect(await checkAfterGrace(SESSION, d)).toBe('closed')
    expect(d.connectedIdentities).not.toHaveBeenCalled()
  })

  it('checks only after RECONNECT_GRACE_SEC, once per session (restarts on a new leave)', async () => {
    const d = deps()
    scheduleGraceCheck(SESSION, d)
    await vi.advanceTimersByTimeAsync(30_000)
    scheduleGraceCheck(SESSION, d) // another participant left: restart
    expect(pendingGraceChecks()).toBe(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(d.loadSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(d.loadSession).toHaveBeenCalledOnce()
    expect(d.endSession).toHaveBeenCalledWith(SESSION, 'reconnect_timeout')
    expect(pendingGraceChecks()).toBe(0)
  })
})

describe('LiveKit lookups (defaultGraceDeps)', () => {
  it('a missing room means nobody is there; any other error is not a verdict', async () => {
    vi.resetModules()
    const listParticipants = vi.fn()
    vi.doMock('@/lib/livekit/server', () => ({
      roomNameFor: (id: string) => `tv-${id}`,
      roomService: () => ({ listParticipants }),
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
    const { defaultGraceDeps } = await import('@/lib/livekit/grace')
    const { connectedIdentities } = defaultGraceDeps()

    listParticipants.mockRejectedValueOnce(Object.assign(new Error('no room'), { status: 404 }))
    await expect(connectedIdentities(SESSION)).resolves.toEqual([])
    listParticipants.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
    await expect(connectedIdentities(SESSION)).rejects.toThrow('boom')
    listParticipants.mockRejectedValueOnce(new Error('fetch failed'))
    await expect(connectedIdentities(SESSION)).rejects.toThrow('fetch failed')
    listParticipants.mockResolvedValueOnce([{ identity: 'guest-1' }])
    await expect(connectedIdentities(SESSION)).resolves.toEqual(['guest-1'])
  })
})
