import { createHash, randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { TokenVerifier } from 'livekit-server-sdk'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENV } from '../mocks/env'
import { createTestDb, createUser } from './harness'

let db: PGlite
let currentUser: string | null = null

/** supabase-js `.rpc(fn, args)` served by the in-process database (named arguments). */
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const keys = Object.keys(args).filter((k) => args[k] !== undefined)
  const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      sql,
      keys.map((k) => args[k]),
    )
    const scalar = rows.length === 1 && Object.keys(rows[0]!).length === 1 && fn in rows[0]!
    return { data: scalar ? rows[0]![fn] : rows, error: null }
  } catch (error) {
    return { data: null, error: { message: (error as Error).message } }
  }
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: async () => (currentUser ? { id: currentUser } : null),
}))

const { GET: tokenRoute } = await import('@/app/api/livekit/token/route')
const { roomNameFor } = await import('@/lib/livekit/server')

const verifier = new TokenVerifier(TEST_ENV.LIVEKIT_API_KEY, TEST_ENV.LIVEKIT_API_SECRET)
const token = async (user: string, sessionId: string) => {
  currentUser = user
  const res = await tokenRoute(
    new NextRequest(`https://meet.transvoice.ai/api/livekit/token?sessionId=${sessionId}`),
  )
  const body = (await res.json()) as { token: string; room: string; role: string; status: string }
  const claims = await verifier.verify(body.token)
  return { ...body, grantedRoom: claims.video?.room }
}

beforeEach(async () => {
  db = await createTestDb()
}, 30_000)

describe('host and guest get a token for the same LiveKit room', () => {
  it('guest accepts an invite made from the dashboard while the host is live: same room', async () => {
    const host = await createUser(db, 'host@example.com', { fullName: 'Host' })
    const guest = await createUser(db, 'guest@example.com', { fullName: 'Guest' })

    // Host: Start meeting → lobby → room → Start.
    const created = await rpc('create_meeting', { p_user: host })
    const meeting = created.data as string
    const opened = (await rpc('open_call_session', { p_meeting: meeting, p_user: host })).data as {
      session_id: string
    }[]
    const sessionId = opened[0]!.session_id
    await rpc('start_call_session', { p_session: sessionId, p_user: host })
    const hostToken = await token(host, sessionId)

    // Host: dashboard → Invite Partner (no meeting id). Guest: opens /invite/<token>, accepts.
    const raw = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(raw).digest('hex')
    const invitation = (
      await rpc('create_invitation', {
        p_user: host,
        p_token_hash: hash,
        p_window: '7 days',
        p_meeting: undefined,
      })
    ).data as { meeting_id: string; reused: boolean }[]
    expect(invitation[0]).toMatchObject({ meeting_id: meeting, reused: true })
    const accepted = (await rpc('accept_invitation', { p_token_hash: hash, p_user: guest })).data
    expect(accepted).toBe(meeting)

    // Guest: lobby → room page (open_call_session) → token for the session the page returned.
    const guestSession = (await rpc('open_call_session', { p_meeting: accepted, p_user: guest }))
      .data as { session_id: string; status: string; created: boolean }[]
    expect(guestSession[0]).toMatchObject({ session_id: sessionId, status: 'live', created: false })
    const guestToken = await token(guest, guestSession[0]!.session_id)

    expect(hostToken).toMatchObject({ role: 'host', room: roomNameFor(sessionId) })
    expect(guestToken).toMatchObject({
      role: 'guest',
      room: roomNameFor(sessionId),
      status: 'live',
    })
    expect(guestToken.room).toBe(hostToken.room)
    expect(guestToken.grantedRoom).toBe(hostToken.grantedRoom) // the signed grant, not just the echo
  })

  it('a token for an ended session is refused (a stale tab cannot join a dead room)', async () => {
    const host = await createUser(db, 'host2@example.com')
    const meeting = (await rpc('create_meeting', { p_user: host })).data as string
    const sessionId = (
      (await rpc('open_call_session', { p_meeting: meeting, p_user: host })).data as {
        session_id: string
      }[]
    )[0]!.session_id
    await rpc('end_call_session', { p_session: sessionId, p_user: host })
    currentUser = host
    const res = await tokenRoute(
      new NextRequest(`https://meet.transvoice.ai/api/livekit/token?sessionId=${sessionId}`),
    )
    expect(res.status).toBe(409)
  })
})
