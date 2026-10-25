import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
let meeting: string
let hash: string
let invitation: string

const newHash = () => createHash('sha256').update(randomBytes(32)).digest('hex')
async function invite(maxUses?: number) {
  const h = newHash()
  const { rows } = await db.query<{ meeting_id: string; invitation_id: string }>(
    maxUses === undefined
      ? `select * from public.create_invitation($1, $2, '7 days', $3)`
      : `select * from public.create_invitation($1, $2, '7 days', $3, ${maxUses})`,
    [host, h, meeting],
  )
  return { hash: h, invitation: rows[0]!.invitation_id }
}
const accept = async (h: string, user: string) =>
  (await db.query<{ m: string }>('select public.accept_invitation($1, $2) m', [h, user])).rows[0]!.m
const counts = async () =>
  (
    await db.query<{ meetings: number; sessions: number; connections: number; used: number }>(
      `select (select count(*)::int from public.meetings) meetings,
              (select count(*)::int from public.call_sessions) sessions,
              (select count(*)::int from public.sponsored_connections) connections,
              (select coalesce(sum(used_count), 0)::int from public.invitations) used`,
    )
  ).rows[0]!

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com', { fullName: 'Host' })
  guest = await createUser(db, 'guest@example.com', { fullName: 'Guest' })
  meeting = (await db.query<{ id: string }>('select public.create_meeting($1) id', [host])).rows[0]!
    .id
  ;({ hash, invitation } = await invite())
}, 30_000)

describe('a multi-use invite link', () => {
  it('defaults to 20 places, selectable from 1 to 100', async () => {
    const max = async (id: string) =>
      (
        await db.query<{ m: number }>('select max_uses m from public.invitations where id = $1', [
          id,
        ])
      ).rows[0]!.m
    expect(await max(invitation)).toBe(20)
    expect(await max((await invite(100)).invitation)).toBe(100)
    expect(await max((await invite(1)).invitation)).toBe(1)
    await expect(invite(0)).rejects.toThrow(/INVALID_MAX_USES/)
    await expect(invite(101)).rejects.toThrow(/INVALID_MAX_USES/)
  })

  it('the same user opening it twice lands in the same meeting; nothing new is created', async () => {
    expect(await accept(hash, guest)).toBe(meeting)
    const after = await counts()
    expect(await accept(hash, guest)).toBe(meeting)
    expect(await accept(hash, guest)).toBe(meeting)
    expect(await counts()).toEqual(after) // no 2nd connection, no used place, no meeting, no session
    expect(after).toMatchObject({ meetings: 1, sessions: 0, connections: 1, used: 1 })
  })

  it('two different new users both get in, each using one place', async () => {
    const second = await createUser(db, 'second@example.com')
    expect(await accept(hash, guest)).toBe(meeting)
    expect(await accept(hash, second)).toBe(meeting)
    expect(await counts()).toMatchObject({ meetings: 1, connections: 2, used: 2 })
  })

  it('a full link keeps working for the people already in, and tells the others it is full', async () => {
    const two = await invite(2)
    const users = [
      guest,
      await createUser(db, 'b@example.com'),
      await createUser(db, 'c@example.com'),
    ]
    await accept(two.hash, users[0]!)
    await accept(two.hash, users[1]!)
    await expect(accept(two.hash, users[2]!)).rejects.toThrow(/INVITE_USED/)
    expect(await accept(two.hash, users[0]!)).toBe(meeting) // already in: still fine
    expect(await accept(two.hash, users[1]!)).toBe(meeting)
  })

  it('an expired link is refused for everyone but the host, new and returning users alike', async () => {
    await accept(hash, guest)
    await db.query(`update public.invitations set expires_at = now() - interval '1 second'`)
    await expect(accept(hash, guest)).rejects.toThrow(/INVITE_EXPIRED/)
    await expect(accept(hash, await createUser(db, 'late@example.com'))).rejects.toThrow(
      /INVITE_EXPIRED/,
    )
    expect(await accept(hash, host)).toBe(meeting) // the host can always open their own link
  })

  it('a revoked link is refused for everyone but the host; connections already made stay', async () => {
    await accept(hash, guest)
    const revoked = await db.query<{ r: boolean }>('select public.revoke_invitation($1, $2) r', [
      host,
      hash,
    ])
    expect(revoked.rows[0]!.r).toBe(true)
    await expect(accept(hash, guest)).rejects.toThrow(/INVITE_REVOKED/)
    await expect(accept(hash, await createUser(db, 'new@example.com'))).rejects.toThrow(
      /INVITE_REVOKED/,
    )
    expect(await accept(hash, host)).toBe(meeting)
    expect((await counts()).connections).toBe(1) // their own sponsorship window still runs
    // Revoking twice, or someone else's link, does nothing.
    expect(
      (await db.query<{ r: boolean }>('select public.revoke_invitation($1, $2) r', [host, hash]))
        .rows[0]!.r,
    ).toBe(false)
    const fresh = await invite()
    expect(
      (
        await db.query<{ r: boolean }>('select public.revoke_invitation($1, $2) r', [
          guest,
          fresh.hash,
        ])
      ).rows[0]!.r,
    ).toBe(false)
    expect(await accept(fresh.hash, guest)).toBe(meeting)
  })
})

describe('reopening the link after the meeting ended', () => {
  it('opens the SAME meeting; a user with call rights gets a new ready session in it', async () => {
    await accept(hash, guest)
    const first = await db.query<{ session_id: string }>(
      'select * from public.open_call_session($1, $2)',
      [meeting, host],
    )
    await db.query('select public.end_call_session($1, $2)', [first.rows[0]!.session_id, host])

    // Next day, the guest clicks the same link again.
    expect(await accept(hash, guest)).toBe(meeting)
    const again = await db.query<{ session_id: string; status: string; created: boolean }>(
      'select * from public.open_call_session($1, $2)',
      [meeting, guest],
    )
    expect(again.rows[0]).toMatchObject({ status: 'ready', created: true })
    expect(again.rows[0]!.session_id).not.toBe(first.rows[0]!.session_id)
    expect((await counts()).meetings).toBe(1) // never a new meeting
  })

  it('the link never creates a session by itself: only opening the room does', async () => {
    await accept(hash, guest)
    await accept(hash, await createUser(db, 'x@example.com'))
    expect((await counts()).sessions).toBe(0)
  })
})
