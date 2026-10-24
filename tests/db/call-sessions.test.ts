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

const open = async (user: string) =>
  (
    await db.query<{ session_id: string; status: string; host_id: string }>(
      'select * from public.open_call_session($1, $2)',
      [meeting, user],
    )
  ).rows[0]!
const admit = (session: string, user: string) =>
  db.query<{ role: string; payer_id: string; spoken_lang: string; display_name: string }>(
    'select * from public.admit_participant($1, $2)',
    [session, user],
  )
const start = (session: string, user: string) =>
  db.query<{ session_id: string; started_at: Date }>(
    'select * from public.start_call_session($1, $2)',
    [session, user],
  )
const drain = (user: string) =>
  db.query(`select public.debit_minutes($1, $2, 'test')`, [user, FREE_TRIAL_MINUTES])
const expireSponsorship = () =>
  db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
const rights = async (user: string) =>
  (await db.query<{ r: string | null }>('select public.call_rights($1, $2) r', [meeting, user]))
    .rows[0]!.r

describe('call_rights', () => {
  it('host, sponsored guest, member after expiry, stranger', async () => {
    const stranger = await createUser(db, 'stranger@example.com')
    expect(await rights(host)).toBe('host')
    expect(await rights(guest)).toBe('sponsored')
    expect(await rights(stranger)).toBeNull()
    await expireSponsorship()
    expect(await rights(guest)).toBe('member')
  })
})

describe('open_call_session', () => {
  it('creates one ready session per meeting and returns it to everyone with rights', async () => {
    const first = await open(guest)
    expect(first).toMatchObject({ status: 'ready', host_id: host })
    expect((await open(host)).session_id).toBe(first.session_id)
  })

  it('refuses users without rights', async () => {
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(open(stranger)).rejects.toThrow(/NOT_ALLOWED/)
  })
})

describe('admit_participant (LiveKit token gate)', () => {
  it('admits the host (paying for themselves) and the sponsored guest (paid by the host)', async () => {
    const { session_id } = await open(host)
    expect((await admit(session_id, host)).rows[0]).toMatchObject({
      role: 'host',
      payer_id: host,
      display_name: 'Host',
      spoken_lang: 'en-US',
    })
    expect((await admit(session_id, guest)).rows[0]).toMatchObject({
      role: 'guest',
      payer_id: host,
    })
    const { rows } = await db.query(
      'select user_id from public.meeting_participants where session_id = $1',
      [session_id],
    )
    expect(rows).toHaveLength(2)
  })

  it('admits the host even at 0 minutes (Start is what needs minutes)', async () => {
    const { session_id } = await open(host)
    await drain(host)
    await expect(admit(session_id, host)).resolves.toBeDefined()
    await expect(start(session_id, host)).rejects.toThrow(/NO_MINUTES/)
  })

  it('after the window expires the guest pays for themselves (Rule 3)', async () => {
    const { session_id } = await open(host)
    await expireSponsorship()
    expect((await admit(session_id, guest)).rows[0]).toMatchObject({ payer_id: guest })
  })

  it('refuses an expired guest with 0 minutes', async () => {
    const { session_id } = await open(host)
    await expireSponsorship()
    await drain(guest)
    await expect(admit(session_id, guest)).rejects.toThrow(/NO_MINUTES/)
  })

  it('refuses strangers, closed and unknown sessions', async () => {
    const { session_id } = await open(host)
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(admit(session_id, stranger)).rejects.toThrow(/NOT_ALLOWED/)
    await db.query('select public.end_call_session($1, $2)', [session_id, host])
    await expect(admit(session_id, guest)).rejects.toThrow(/SESSION_CLOSED/)
    await expect(admit('00000000-0000-4000-8000-000000000000', guest)).rejects.toThrow(/NO_SESSION/)
  })
})

describe('start_call_session / end_call_session', () => {
  it('ready → live → ended; a new open creates a new session', async () => {
    const { session_id } = await open(host)
    await expect(start(session_id, guest)).rejects.toThrow(/NOT_HOST/)
    const live = (await start(session_id, host)).rows[0]!
    expect((await start(session_id, host)).rows[0]!.started_at).toEqual(live.started_at)

    await expect(
      db.query('select public.end_call_session($1, $2)', [session_id, guest]),
    ).rejects.toThrow(/NOT_HOST/)
    const ended = await db.query<{ ok: boolean }>(
      `select public.end_call_session($1, null, 'reconnect_timeout') ok`,
      [session_id],
    )
    expect(ended.rows[0]!.ok).toBe(true)
    const { rows } = await db.query<{ status: string; end_reason: string }>(
      'select status, end_reason from public.call_sessions where id = $1',
      [session_id],
    )
    expect(rows[0]).toEqual({ status: 'ended', end_reason: 'reconnect_timeout' })
    expect((await open(host)).session_id).not.toBe(session_id)
  })

  it('none of the call functions are callable by users', async () => {
    for (const sql of [
      `select public.call_rights('${meeting}', '${host}')`,
      `select * from public.open_call_session('${meeting}', '${host}')`,
      `select * from public.admit_participant(gen_random_uuid(), '${host}')`,
      `select * from public.start_call_session(gen_random_uuid(), '${host}')`,
      `select public.end_call_session(gen_random_uuid(), '${host}')`,
    ]) {
      await expect(asUser(db, host, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})
