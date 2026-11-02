import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.fn()
const rpc = vi.fn()
const checkRateLimit = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }))
const { POST } = await import('@/app/api/heartbeat/route')

const SESSION = '33333333-3333-4333-8333-333333333333'
const post = (body: unknown) =>
  POST(
    new NextRequest('https://meet.transvoice.ai/api/heartbeat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: 'user-1', email: 'secret@example.com' })
  checkRateLimit.mockResolvedValue(true)
  rpc.mockResolvedValue({ data: 'ok', error: null })
})

describe('POST /api/heartbeat', () => {
  it('records the heartbeat for the signed-in user, using the local JWT check', async () => {
    const res = await post({ sessionId: SESSION })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: 'ok' })
    expect(rpc).toHaveBeenCalledWith('record_heartbeat', { p_session: SESSION, p_user: 'user-1' })
    expect(getSessionUser).toHaveBeenCalledWith({ local: true })
  })

  it('401 without a session, 400 without a session id, 429 when rate limited, 503 on a database error', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await post({ sessionId: SESSION })).status).toBe(401)
    expect((await post({})).status).toBe(400)
    checkRateLimit.mockResolvedValueOnce(false)
    expect((await post({ sessionId: SESSION })).status).toBe(429)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    expect((await post({ sessionId: SESSION })).status).toBe(503)
    expect(rpc).toHaveBeenCalledTimes(1) // only the last request got past auth, validation and the limiter
  })

  it('cannot be pointed at another user: the user id comes only from the session', async () => {
    await post({ sessionId: SESSION, userId: 'someone-else' })
    expect(rpc).toHaveBeenCalledWith('record_heartbeat', { p_session: SESSION, p_user: 'user-1' })
  })
})
