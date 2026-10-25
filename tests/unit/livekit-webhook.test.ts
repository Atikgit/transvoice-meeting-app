import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENV } from '../mocks/env'

const rpc = vi.fn()
const scheduleGraceCheck = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/livekit/grace', () => ({ scheduleGraceCheck }))
const invalidateConnected = vi.fn()
vi.mock('@/lib/livekit/connected', () => ({ invalidateConnected }))

const { POST } = await import('@/app/api/livekit/webhook/route')

const SESSION = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

/** Signs a webhook body the way LiveKit does (JWT with the body's sha256). */
async function signed(body: string, secret: string = TEST_ENV.LIVEKIT_API_SECRET) {
  const token = new AccessToken(TEST_ENV.LIVEKIT_API_KEY, secret)
  token.sha256 = createHash('sha256').update(body).digest('base64')
  return token.toJwt()
}

async function deliver(payload: Record<string, unknown>, auth?: string) {
  const body = JSON.stringify(payload)
  return POST(
    new NextRequest('https://meet.transvoice.ai/api/livekit/webhook', {
      method: 'POST',
      body,
      headers: {
        authorization: auth ?? (await signed(body)),
        'content-type': 'application/webhook+json',
      },
    }),
  )
}

const joined = (id = 'EV_1', event = 'participant_joined') => ({
  id,
  event,
  createdAt: 1_761_300_000,
  room: { name: `tv-${SESSION}` },
  participant: { identity: USER, name: 'Guest' },
})

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: 'ok', error: null })
})

describe('POST /api/livekit/webhook', () => {
  it('records participant_joined with the event id, session and user', async () => {
    const res = await deliver(joined())
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_livekit_event', {
      p_event_id: 'EV_1',
      p_event: 'participant_joined',
      p_session: SESSION,
      p_user: USER,
      p_at: new Date(1_761_300_000 * 1000).toISOString(),
    })
    expect(scheduleGraceCheck).not.toHaveBeenCalled()
  })

  it('a join or leave makes the next translation ask LiveKit who is connected again', async () => {
    await deliver(joined('EV_J'))
    expect(invalidateConnected).toHaveBeenCalledWith(SESSION)
    invalidateConnected.mockClear()
    await deliver(joined('EV_L', 'participant_left'))
    expect(invalidateConnected).toHaveBeenCalledWith(SESSION)
  })

  it('participant_left starts the reconnect grace check', async () => {
    await deliver(joined('EV_2', 'participant_left'))
    expect(scheduleGraceCheck).toHaveBeenCalledWith(SESSION)
  })

  it('a duplicate event changes nothing and does not restart the timer', async () => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null })
    const res = await deliver(joined('EV_2', 'participant_left'))
    expect(await res.json()).toEqual({ result: 'duplicate' })
    expect(scheduleGraceCheck).not.toHaveBeenCalled()
  })

  it('rejects a bad or missing signature', async () => {
    const body = JSON.stringify(joined())
    expect((await deliver(joined(), await signed(body, 'wrong-secret'))).status).toBe(401)
    expect((await deliver(joined(), 'not-a-jwt')).status).toBe(401)
    // Signed for a different body (tampered payload).
    expect((await deliver({ ...joined(), id: 'EV_TAMPERED' }, await signed(body))).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ignores rooms that are not call sessions and unrelated events', async () => {
    expect(await (await deliver({ ...joined(), room: { name: 'other-room' } })).json()).toEqual({
      result: 'ignored',
    })
    expect(await (await deliver({ ...joined(), event: 'track_published' })).json()).toEqual({
      result: 'ignored',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('asks LiveKit to retry when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    expect((await deliver(joined())).status).toBe(500)
  })
})
