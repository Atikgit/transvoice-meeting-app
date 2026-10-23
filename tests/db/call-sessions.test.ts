import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import { asUser, createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
let meeting: string

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const { rows } = await db.query<{ meeting_id: string }>(
    `select meeting_id from public.create_invitation($1, $2, '7 days', null)`,
    [host, hash],
  )
  meeting = rows[0]!.meeting_id
  await db.query('select public.accept_invitation($1, $2)', [hash, guest])
}, 30_000)

const start = (user: string) =>
  db.query<{ session_id: string; started_at: Date }>(
    'select * from public.start_call_session($1, $2)',
    [meeting, user],
  )
const join = (session: string, user: string) =>
  db.query<{ role: string }>('select public.join_call_session($1, $2) role', [session, user])
const participants = async (session: string) =>
  (
    await db.query<{ user_id: string; role: string; payer_id: string }>(
      'select user_id, role, payer_id from public.meeting_participants where session_id = $1 order by role desc',
      [session],
    )
  ).rows

describe('start_call_session', () => {
  it('makes a live session with the host as participant and payer', async () => {
    const { rows } = await start(host)
    const session = rows[0]!.session_id
    const { rows: s } = await db.query<{ status: string; host_id: string }>(
      'select status, host_id from public.call_sessions where id = $1',
      [session],
    )
    expect(s[0]).toEqual({ status: 'live', host_id: host })
    expect(await participants(session)).toEqual([{ user_id: host, role: 'host', payer_id: host }])
  })

  it('is idempotent while live', async () => {
    const first = (await start(host)).rows[0]!
    const again = (await start(host)).rows[0]!
    expect(again.session_id).toBe(first.session_id)
  })

  it('only the host can start, and only with minutes', async () => {
    await expect(start(guest)).rejects.toThrow(/NOT_HOST/)
    await db.query(`select public.debit_minutes($1, $2, 'test')`, [host, FREE_TRIAL_MINUTES])
    await expect(start(host)).rejects.toThrow(/NO_MINUTES/)
  })
})

describe('join_call_session', () => {
  it('bills a sponsored guest to the sponsor (Rule 2)', async () => {
    const session = (await start(host)).rows[0]!.session_id
    expect((await join(session, guest)).rows[0]!.role).toBe('guest')
    await join(session, guest)
    expect(await participants(session)).toEqual([
      { user_id: host, role: 'host', payer_id: host },
      { user_id: guest, role: 'guest', payer_id: host },
    ])
  })

  it('after the window expires the guest pays, and needs minutes (Rule 3)', async () => {
    await db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
    const session = (await start(host)).rows[0]!.session_id
    await join(session, guest)
    expect((await participants(session)).find((p) => p.user_id === guest)?.payer_id).toBe(guest)

    const other = (await db.query<{ id: string }>('select id from public.call_sessions')).rows[0]!
      .id
    const broke = await createUser(db, 'broke@example.com')
    await db.query(`select public.debit_minutes($1, $2, 'test')`, [broke, FREE_TRIAL_MINUTES])
    await db.query(
      `insert into public.sponsored_connections (sponsor_id, guest_id, meeting_id, expires_at)
       values ($1, $2, $3, now() - interval '1 s')`,
      [host, broke, meeting],
    )
    await expect(join(other, broke)).rejects.toThrow(/NO_MINUTES/)
  })

  it('rejects strangers and sessions that are not live', async () => {
    const session = (await start(host)).rows[0]!.session_id
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(join(session, stranger)).rejects.toThrow(/NOT_ALLOWED/)
    await db.query('select public.end_call_session($1, $2)', [session, host])
    await expect(join(session, guest)).rejects.toThrow(/SESSION_NOT_LIVE/)
  })
})

describe('end_call_session', () => {
  it('host only; records the end', async () => {
    const session = (await start(host)).rows[0]!.session_id
    await expect(
      db.query('select public.end_call_session($1, $2)', [session, guest]),
    ).rejects.toThrow(/NOT_HOST_OR_NOT_LIVE/)
    await db.query('select public.end_call_session($1, $2)', [session, host])
    const { rows } = await db.query<{ status: string; end_reason: string; ended: boolean }>(
      'select status, end_reason, ended_at is not null ended from public.call_sessions where id = $1',
      [session],
    )
    expect(rows[0]).toEqual({ status: 'ended', end_reason: 'host_ended', ended: true })
    // A new Start creates a new session.
    expect((await start(host)).rows[0]!.session_id).not.toBe(session)
  })

  it('none of the session functions are callable by users', async () => {
    for (const sql of [
      `select * from public.start_call_session('${meeting}', '${host}')`,
      `select public.end_call_session(gen_random_uuid(), '${host}')`,
      `select public.join_call_session(gen_random_uuid(), '${host}')`,
    ]) {
      await expect(asUser(db, host, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})
