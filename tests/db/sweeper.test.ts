import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
let meeting: string
let session: string

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
  const opened = await db.query<{ session_id: string }>(
    'select * from public.open_call_session($1, $2)',
    [meeting, host],
  )
  session = opened.rows[0]!.session_id
}, 30_000)

const stale = async (interval: string) =>
  (
    await db.query<{ session_id: string }>(
      'select * from public.stale_open_sessions($1::interval)',
      [interval],
    )
  ).rows.map((r) => r.session_id)

describe('stale_open_sessions', () => {
  it('lists ready/live sessions older than the interval only', async () => {
    expect(await stale('60 seconds')).toEqual([])
    await db.query(`update public.call_sessions set created_at = now() - interval '10 minutes'`)
    expect(await stale('60 seconds')).toEqual([session])
    await db.query(`update public.call_sessions set status = 'ended', ended_at = now()`)
    expect(await stale('60 seconds')).toEqual([])
  })

  it('measures a live session from its start, not its creation', async () => {
    await db.query(
      `update public.call_sessions set status = 'live', created_at = now() - interval '1 hour',
         started_at = now() - interval '5 seconds'`,
    )
    expect(await stale('60 seconds')).toEqual([])
  })
})

describe('sweep_orphans', () => {
  it('closes open segments of ended sessions, never of open ones', async () => {
    await db.query(
      `insert into public.participant_segments (session_id, user_id, payer_id, connected_at)
       values ($1, $2, $3, now() - interval '10 minutes')`,
      [session, guest, host],
    )
    const open = async () =>
      (
        await db.query<{ n: number }>(
          `select count(*)::int n from public.participant_segments where disconnected_at is null`,
        )
      ).rows[0]!.n
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_closed: 0,
    })
    expect(await open()).toBe(1)

    await db.query(`update public.call_sessions set status = 'ended', ended_at = now()`)
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_closed: 1,
    })
    expect(await open()).toBe(0)
    // Idempotent
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_closed: 0,
    })
  })

  it('marks unanswered ringing calls as missed', async () => {
    await db.query(`update public.call_sessions set status = 'ended', ended_at = now()`)
    await db.query(
      `insert into public.call_sessions (meeting_id, host_id, initiated_by, callee_id, status, created_at)
       values ($1, $2, $3, $2, 'ringing', now() - interval '2 minutes')`,
      [meeting, host, guest],
    )
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      ringing_expired: 1,
    })
    const { rows } = await db.query<{ status: string; end_reason: string }>(
      `select status, end_reason from public.call_sessions where id <> $1`,
      [session],
    )
    expect(rows[0]).toEqual({ status: 'missed', end_reason: 'no_answer' })
  })
})
