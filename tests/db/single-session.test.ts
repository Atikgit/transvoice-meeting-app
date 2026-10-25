import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
let meeting: string

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex')
const invite = async (user: string, p_meeting: string | null = null) =>
  (
    await db.query<{ meeting_id: string; reused: boolean }>(
      `select * from public.create_invitation($1, $2, '7 days', $3)`,
      [user, hash(), p_meeting],
    )
  ).rows[0]!
const accept = async (user: string, m = meeting) => {
  const token = hash()
  await db.query(`select * from public.create_invitation($1, $2, '7 days', $3)`, [host, token, m])
  await db.query('select public.accept_invitation($1, $2)', [token, user])
}
type Opened = { session_id: string; status: string; started_at: Date | null; created: boolean }
const open = async (user: string, m = meeting) =>
  (await db.query<Opened>('select * from public.open_call_session($1, $2)', [m, user])).rows[0]!
const start = (session: string, user = host) =>
  db.query<{ session_id: string; started_at: Date }>(
    'select * from public.start_call_session($1, $2)',
    [session, user],
  )
const openSessions = async (m = meeting) =>
  (
    await db.query<{ id: string }>(
      `select id from public.call_sessions where meeting_id = $1 and status in ('ready','live')`,
      [m],
    )
  ).rows

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com', { fullName: 'Host' })
  guest = await createUser(db, 'guest@example.com', { fullName: 'Guest' })
  meeting = (await invite(host)).meeting_id
  await accept(guest)
}, 30_000)

describe('one open session per meeting', () => {
  it('host starts first, then the guest opens the room: same session, already live', async () => {
    const hostSession = await open(host)
    expect(hostSession).toMatchObject({ status: 'ready', created: true })
    const started = (await start(hostSession.session_id)).rows[0]!

    const guestSession = await open(guest)
    expect(guestSession).toMatchObject({
      session_id: hostSession.session_id,
      status: 'live',
      created: false,
    })
    expect(guestSession.started_at).toEqual(started.started_at)
    expect(await openSessions()).toHaveLength(1)
  })

  it('guest opens first, then the host opens and starts: same session throughout', async () => {
    const guestSession = await open(guest)
    expect(guestSession).toMatchObject({ status: 'ready', created: true })
    const hostSession = await open(host)
    expect(hostSession).toMatchObject({ session_id: guestSession.session_id, created: false })
    await start(hostSession.session_id)
    expect((await open(guest)).status).toBe('live')
    expect(await openSessions()).toHaveLength(1)
  })

  it('two guests opening at the same moment get the same session; exactly one creates it', async () => {
    const second = await createUser(db, 'second@example.com')
    await accept(second)
    const results = await Promise.all([open(guest), open(second), open(host)])
    expect(new Set(results.map((r) => r.session_id)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(await openSessions()).toHaveLength(1)
  })

  it('a double click on Start starts once and keeps the first started_at', async () => {
    const { session_id } = await open(host)
    const [a, b] = await Promise.all([start(session_id), start(session_id)])
    expect(a.rows[0]!.started_at).toEqual(b.rows[0]!.started_at)
    const { rows } = await db.query<{ status: string }>(
      'select status from public.call_sessions where id = $1',
      [session_id],
    )
    expect(rows[0]!.status).toBe('live')
  })

  it('the database refuses a second open session even if the function is bypassed', async () => {
    await open(host)
    await expect(
      db.query(
        `insert into public.call_sessions (meeting_id, host_id, initiated_by, status)
         values ($1, $2, $2, 'ready')`,
        [meeting, host],
      ),
    ).rejects.toThrow(/call_sessions_one_open_per_meeting/)
  })

  it('after the session ends, opening the room starts a new one', async () => {
    const first = await open(host)
    await db.query(`select public.end_call_session($1, $2)`, [first.session_id, host])
    const next = await open(guest)
    expect(next.session_id).not.toBe(first.session_id)
    expect(next.created).toBe(true)
  })

  it('a stranger cannot open the room', async () => {
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(open(stranger)).rejects.toThrow(/NOT_ALLOWED/)
  })
})

describe('Invite Partner without a meeting reuses the host’s current meeting', () => {
  it('with a live session in the meeting, the link points to that meeting', async () => {
    const { session_id } = await open(host)
    await start(session_id)
    const link = await invite(host)
    expect(link).toMatchObject({ meeting_id: meeting, reused: true })
  })

  it('a meeting created by Start meeting that has no session yet (host in the lobby) is reused', async () => {
    const lobby = (await db.query<{ id: string }>(`select public.create_meeting($1) id`, [host]))
      .rows[0]!.id
    expect((await invite(host)).meeting_id).toBe(lobby)
  })

  it('with nothing current, a new meeting is created', async () => {
    const first = await open(host)
    await db.query(`select public.end_call_session($1, $2)`, [first.session_id, host])
    const link = await invite(host)
    expect(link.reused).toBe(false)
    expect(link.meeting_id).not.toBe(meeting)
  })

  it('an explicit meeting id always wins', async () => {
    const other = (await db.query<{ id: string }>(`select public.create_meeting($1) id`, [host]))
      .rows[0]!.id
    await open(host) // `meeting` now has the open session
    expect(await invite(host, other)).toMatchObject({ meeting_id: other, reused: true })
  })

  it('a guest accepting that link lands in the host’s live meeting and session', async () => {
    const hostSession = await open(host)
    await start(hostSession.session_id)
    const token = hash()
    const link = (
      await db.query<{ meeting_id: string }>(
        `select * from public.create_invitation($1, $2, '7 days', null)`,
        [host, token],
      )
    ).rows[0]!
    const newGuest = await createUser(db, 'newguest@example.com')
    const joined = (
      await db.query<{ m: string }>('select public.accept_invitation($1, $2) m', [token, newGuest])
    ).rows[0]!.m
    expect(joined).toBe(link.meeting_id)
    expect(joined).toBe(meeting)
    const session = await open(newGuest, joined)
    expect(session).toMatchObject({ session_id: hostSession.session_id, status: 'live' })
  })
})
