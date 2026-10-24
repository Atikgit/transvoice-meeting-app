import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
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
  await db.query('select public.accept_invitation($1, $2)', [hash, guest])
  const opened = await db.query<{ session_id: string }>(
    'select * from public.open_call_session($1, $2)',
    [rows[0]!.meeting_id, host],
  )
  session = opened.rows[0]!.session_id
  await db.query('select * from public.admit_participant($1, $2)', [session, guest])
}, 30_000)

let n = 0
const event = (kind: string, user: string | null, at = '2026-10-24T10:00:00Z', id = `EV_${++n}`) =>
  db
    .query<{ r: string }>('select public.record_livekit_event($1, $2, $3, $4, $5) r', [
      id,
      kind,
      session,
      user,
      at,
    ])
    .then((res) => res.rows[0]!.r)
const segments = async () =>
  (
    await db.query<{ user_id: string; payer_id: string; open: boolean }>(
      `select user_id, payer_id, disconnected_at is null open from public.participant_segments
       where session_id = $1 order by connected_at, user_id`,
      [session],
    )
  ).rows

describe('record_livekit_event', () => {
  it('joined opens a segment billed to the payer (sponsored guest → host); left closes it', async () => {
    expect(await event('participant_joined', guest)).toBe('ok')
    expect(await segments()).toEqual([{ user_id: guest, payer_id: host, open: true }])
    expect(await event('participant_left', guest, '2026-10-24T10:05:00Z')).toBe('ok')
    expect(await segments()).toEqual([{ user_id: guest, payer_id: host, open: false }])
  })

  it('is idempotent on the webhook event id', async () => {
    expect(await event('participant_joined', guest, undefined, 'EV_SAME')).toBe('ok')
    expect(await event('participant_joined', guest, undefined, 'EV_SAME')).toBe('duplicate')
    expect(await segments()).toHaveLength(1)
  })

  it('a second join while connected does not open a second segment; a rejoin opens a new one', async () => {
    await event('participant_joined', guest)
    await event('participant_joined', guest)
    expect(await segments()).toHaveLength(1)
    await event('participant_left', guest, '2026-10-24T10:01:00Z')
    await event('participant_joined', guest, '2026-10-24T10:02:00Z')
    expect((await segments()).map((s) => s.open)).toEqual([false, true])
  })

  it('room_finished closes all segments and ends the session', async () => {
    await event('participant_joined', guest)
    await event('participant_joined', host)
    expect(await event('room_finished', null, '2026-10-24T10:10:00Z')).toBe('ok')
    expect((await segments()).every((s) => !s.open)).toBe(true)
    const { rows } = await db.query<{ status: string; end_reason: string }>(
      'select status, end_reason from public.call_sessions where id = $1',
      [session],
    )
    expect(rows[0]).toEqual({ status: 'ended', end_reason: 'room_finished' })
  })

  it('ignores unknown sessions and users, and never bills', async () => {
    const ignored = await db.query<{ r: string }>(
      `select public.record_livekit_event('EV_X', 'participant_joined', gen_random_uuid(), $1, now()) r`,
      [guest],
    )
    expect(ignored.rows[0]!.r).toBe('ignored')
    expect(await event('participant_joined', '00000000-0000-4000-8000-000000000009')).toBe(
      'ignored',
    )
    const { rows } = await db.query(
      `select 1 from public.usage_ledger where kind in ('debit', 'accrual')`,
    )
    expect(rows).toEqual([])
  })
})
