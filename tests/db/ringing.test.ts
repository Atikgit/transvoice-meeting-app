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
  host = await createUser(db, 'host@example.com', { fullName: 'Host' })
  guest = await createUser(db, 'guest@example.com', { fullName: 'Guest' })
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const { rows } = await db.query<{ meeting_id: string }>(
    `select meeting_id from public.create_invitation($1, $2, '7 days', null)`,
    [host, hash],
  )
  meeting = rows[0]!.meeting_id
  await db.query('select public.accept_invitation($1, $2)', [hash, guest])
}, 30_000)

type Call = {
  mode: string
  meeting_id: string
  session_id: string | null
  callee_id: string | null
}
const call = async (caller: string, m = meeting) =>
  (await db.query<Call>('select * from public.create_call($1, $2)', [m, caller])).rows[0]!
const answer = async (session: string, user: string, accept: boolean) =>
  (
    await db.query<{ meeting_id: string; outcome: string }>(
      'select * from public.answer_call($1, $2, $3)',
      [session, user, accept],
    )
  ).rows[0]!
const status = async (session: string) =>
  (
    await db.query<{ status: string }>('select status from public.call_sessions where id = $1', [
      session,
    ])
  ).rows[0]!.status
const age = (session: string, seconds: number) =>
  db.query(
    `update public.call_sessions set created_at = now() - make_interval(secs => $2) where id = $1`,
    [session, seconds],
  )
const drain = (user: string) =>
  db.query(`select public.debit_minutes($1, $2, 'test')`, [user, FREE_TRIAL_MINUTES])

describe('create_call', () => {
  it('host calls directly (no ringing)', async () => {
    expect(await call(host)).toMatchObject({ mode: 'direct', session_id: null })
  })

  it('a sponsored guest rings the sponsor; repeated presses reuse the ringing call', async () => {
    const first = await call(guest)
    expect(first).toMatchObject({ mode: 'ringing', callee_id: host, meeting_id: meeting })
    expect(await status(first.session_id!)).toBe('ringing')
    expect((await call(guest)).session_id).toBe(first.session_id)
  })

  it('joins an already open session instead of ringing', async () => {
    const { rows } = await db.query<{ session_id: string }>(
      'select * from public.open_call_session($1, $2)',
      [meeting, host],
    )
    expect(await call(guest)).toMatchObject({ mode: 'join', session_id: rows[0]!.session_id })
  })

  it('expired window + own minutes: new meeting hosted and paid by the guest, ringing the former host', async () => {
    await db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
    const result = await call(guest)
    expect(result.mode).toBe('ringing')
    expect(result.callee_id).toBe(host)
    expect(result.meeting_id).not.toBe(meeting)
    const { rows } = await db.query<{ owner_id: string }>(
      'select owner_id from public.meetings where id = $1',
      [result.meeting_id],
    )
    expect(rows[0]!.owner_id).toBe(guest)
    const rights = await db.query<{ r: string }>('select public.call_rights($1, $2) r', [
      result.meeting_id,
      host,
    ])
    expect(rights.rows[0]!.r).toBe('sponsored')
  })

  it('expired window + 0 minutes: cannot call (Subscribe / Message only)', async () => {
    await db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
    await drain(guest)
    await expect(call(guest)).rejects.toThrow(/NO_MINUTES/)
  })

  it('strangers cannot call', async () => {
    const stranger = await createUser(db, 'x@example.com')
    await expect(call(stranger)).rejects.toThrow(/NOT_ALLOWED/)
  })
})

describe('answer_call / cancel_call', () => {
  it('accept turns the ringing call into the open ready session', async () => {
    const { session_id } = await call(guest)
    await expect(answer(session_id!, guest, true)).rejects.toThrow(/NOT_ALLOWED/)
    expect(await answer(session_id!, host, true)).toEqual({
      meeting_id: meeting,
      outcome: 'accepted',
    })
    expect(await status(session_id!)).toBe('ready')
    const { rows } = await db.query<{ session_id: string }>(
      'select * from public.open_call_session($1, $2)',
      [meeting, guest],
    )
    expect(rows[0]!.session_id).toBe(session_id)
  })

  it('decline and cancel close the call', async () => {
    const declined = (await call(guest)).session_id!
    expect((await answer(declined, host, false)).outcome).toBe('declined')
    expect(await status(declined)).toBe('declined')
    const cancelled = (await call(guest)).session_id!
    await db.query('select public.cancel_call($1, $2)', [cancelled, guest])
    expect(await status(cancelled)).toBe('missed')
    expect((await answer(cancelled, host, true)).outcome).toBe('expired')
  })

  it('unanswered calls become missed after 30 s', async () => {
    const { session_id } = await call(guest)
    await age(session_id!, 31)
    expect((await answer(session_id!, host, true)).outcome).toBe('expired')
    expect(await status(session_id!)).toBe('missed')
  })

  it('incoming_calls lists only live ringing calls for the callee', async () => {
    const { session_id } = await call(guest)
    const list = async (user: string) =>
      (
        await db.query<{ session_id: string; caller_name: string }>(
          'select * from public.incoming_calls($1)',
          [user],
        )
      ).rows
    expect(await list(host)).toEqual([
      expect.objectContaining({ session_id, caller_name: 'Guest' }),
    ])
    expect(await list(guest)).toEqual([])
    await age(session_id!, 31)
    expect(await list(host)).toEqual([])
  })

  it('is not callable by users', async () => {
    await expect(
      asUser(db, guest, (tx) =>
        tx.query(`select * from public.create_call('${meeting}', '${guest}')`),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})
