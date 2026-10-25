import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: vi.fn() }) }))

const { POST } = await import('@/app/api/translate/route')
const { startDraining, isDraining } = await import('@/lib/draining')

afterEach(() => {
  ;(globalThis as Record<symbol, unknown>)[Symbol.for('transvoice.draining')] = false
})

describe('POST /api/translate while the server is shutting down', () => {
  it('answers 503 {retryable:true} with Retry-After before doing any work', async () => {
    expect(isDraining()).toBe(false)
    startDraining()
    const res = await POST(
      new NextRequest('https://meet.transvoice.ai/api/translate', {
        method: 'POST',
        body: new FormData(),
      }),
    )
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('2')
    expect(await res.json()).toMatchObject({ code: 'DRAINING', retryable: true })
    expect(getSessionUser).not.toHaveBeenCalled() // rejected before auth, DB or LiveKit
  })
})
