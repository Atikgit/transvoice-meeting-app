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
  const open = async () =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int n from public.participant_segments where disconnected_at is null`,
      )
    ).rows[0]!.n
  /** An open segment joined `joined` ago whose last heartbeat was `beat` ago. */
  const segment = (user: string, joined: string, beat: string) =>
    db.query(
      `insert into public.participant_segments
         (session_id, user_id, payer_id, connected_at, last_heartbeat_at)
       values ($1, $2, $3, now() - $4::interval, now() - $5::interval)`,
      [session, user, host, joined, beat],
    )
  const closedAgo = async (user: string) =>
    Math.round(
      (
        await db.query<{ s: number }>(
          `select extract(epoch from now() - disconnected_at) s
           from public.participant_segments where session_id = $1 and user_id = $2`,
          [session, user],
        )
      ).rows[0]!.s,
    )

  it('ending a session closes its open segments at the last heartbeat, not at now', async () => {
    await segment(guest, '10 minutes', '8 minutes')
    expect(await open()).toBe(1)
    await db.query(`update public.call_sessions set status = 'ended', ended_at = now()`)
    expect(await open()).toBe(0)
    expect(await closedAgo(guest)).toBe(8 * 60) // heartbeat was 8 minutes ago
  })

  it.each(['declined', 'missed'])(
    'a session that becomes %s never keeps open segments',
    async (status) => {
      await segment(guest, '2 minutes', '1 minute')
      await db.query(`update public.call_sessions set status = $1, ended_at = now()`, [status])
      expect(await open()).toBe(0)
    },
  )

  it('closes orphans of already-ended sessions (rows older than the trigger) at the heartbeat', async () => {
    await db.exec('alter table public.call_sessions disable trigger call_sessions_close_segments')
    await segment(guest, '10 minutes', '4 minutes')
    await db.query(`update public.call_sessions set status = 'ended', ended_at = now()`)
    expect(await open()).toBe(1)
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_closed: 1,
    })
    expect(await open()).toBe(0)
    expect(await closedAgo(guest)).toBe(4 * 60)
    // Idempotent
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_closed: 0,
    })
  })

  it('in a live session: a segment silent for 5 minutes is closed at its last heartbeat, one silent for 1 minute is kept', async () => {
    await db.query(
      `update public.call_sessions set status = 'live', started_at = now() - interval '20 minutes'`,
    )
    await segment(guest, '20 minutes', '5 minutes')
    await segment(host, '20 minutes', '1 minute')
    expect((await db.query('select * from public.sweep_orphans()')).rows[0]).toMatchObject({
      segments_stale: 1,
      segments_closed: 0,
    })
    expect(await closedAgo(guest)).toBe(5 * 60)
    expect(await open()).toBe(1) // the host's
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
