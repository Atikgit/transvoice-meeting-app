import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import { asUser, createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com', { fullName: 'Host' })
  guest = await createUser(db, 'guest@example.com', { fullName: 'Guest' })
}, 30_000)

const tokenHash = () => createHash('sha256').update(randomBytes(32)).digest('hex')

async function invite(user: string, window = '7 days', meeting: string | null = null) {
  const hash = tokenHash()
  const { rows } = await db.query<{ meeting_id: string; invitation_id: string; expires_at: Date }>(
    'select * from public.create_invitation($1, $2, $3::interval, $4)',
    [user, hash, window, meeting],
  )
  return { hash, ...rows[0]! }
}

const accept = (hash: string, user: string) =>
  db.query<{ meeting: string }>('select public.accept_invitation($1, $2) meeting', [hash, user])

describe('create_invitation', () => {
  it('creates a meeting owned by the inviter and a link valid for the chosen window', async () => {
    for (const window of ['1 hour', '24 hours', '7 days', '30 days']) {
      const created = await invite(host, window)
      const { rows } = await db.query<{ owner_id: string; sponsor_window: string; ok: boolean }>(
        `select m.owner_id, i.sponsor_window::text,
                abs(extract(epoch from (i.expires_at - now() - $2::interval))) < 5 ok
         from public.invitations i join public.meetings m on m.id = i.meeting_id
         where i.id = $1`,
        [created.invitation_id, window],
      )
      expect(rows[0]).toMatchObject({ owner_id: host, ok: true })
    }
  })

  it('rejects other windows', async () => {
    await expect(invite(host, '2 days')).rejects.toThrow(/check constraint/)
  })

  it('requires available minutes (Rule 1)', async () => {
    await db.query(`select public.debit_minutes($1, $2, 'test')`, [host, FREE_TRIAL_MINUTES])
    await expect(invite(host)).rejects.toThrow(/NO_MINUTES/)
  })

  it('requires a verified email', async () => {
    const unverified = await createUser(db, 'new@example.com', { confirmed: false })
    await expect(invite(unverified)).rejects.toThrow(/EMAIL_NOT_VERIFIED/)
  })

  it('invites into an existing meeting only if the inviter can see it', async () => {
    const { meeting_id } = await invite(host)
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(invite(stranger, '7 days', meeting_id)).rejects.toThrow(/NOT_ALLOWED/)
    const again = await invite(host, '24 hours', meeting_id)
    expect(again.meeting_id).toBe(meeting_id)
  })

  it('stores only the token hash', async () => {
    await expect(
      db.query(`select public.create_invitation($1, 'raw-token', '7 days', null)`, [host]),
    ).rejects.toThrow(/INVALID_TOKEN_HASH/)
  })
})

describe('accept_invitation', () => {
  it('creates the sponsored connection and two-way connections (Rule 3)', async () => {
    const { hash, meeting_id } = await invite(host, '24 hours')
    expect((await accept(hash, guest)).rows[0]!.meeting).toBe(meeting_id)

    const { rows } = await db.query<{ sponsor_id: string; guest_id: string; ok: boolean }>(
      `select sponsor_id, guest_id,
              abs(extract(epoch from (expires_at - now() - interval '24 hours'))) < 5 ok
       from public.sponsored_connections`,
    )
    expect(rows).toEqual([{ sponsor_id: host, guest_id: guest, ok: true }])
    const { rows: links } = await db.query('select user_id, contact_id from public.connections')
    expect(links).toHaveLength(2)

    // The guest can now see the meeting (RLS).
    const visible = await asUser(db, guest, async (tx) => {
      const { rows } = await tx.query('select id from public.meetings')
      return rows
    })
    expect(visible).toEqual([{ id: meeting_id }])
  })

  it('is idempotent for the same guest and usable by others while places remain (default 20)', async () => {
    const { hash } = await invite(host)
    await accept(hash, guest)
    await accept(hash, guest)
    const other = await createUser(db, 'other@example.com')
    await accept(hash, other)
    const { rows } = await db.query<{ used_count: number; max_uses: number }>(
      'select used_count, max_uses from public.invitations',
    )
    expect(rows[0]).toEqual({ used_count: 2, max_uses: 20 })
  })

  it('lets the inviter open their own link', async () => {
    const { hash, meeting_id } = await invite(host)
    expect((await accept(hash, host)).rows[0]!.meeting).toBe(meeting_id)
    const { rows } = await db.query('select 1 from public.sponsored_connections')
    expect(rows).toEqual([])
  })

  it('rejects expired, revoked and unknown links', async () => {
    const expired = await invite(host)
    await db.query(
      `update public.invitations set expires_at = now() - interval '1 second' where id = $1`,
      [expired.invitation_id],
    )
    await expect(accept(expired.hash, guest)).rejects.toThrow(/INVITE_EXPIRED/)

    const revoked = await invite(host)
    await db.query('update public.invitations set revoked_at = now() where id = $1', [
      revoked.invitation_id,
    ])
    await expect(accept(revoked.hash, guest)).rejects.toThrow(/INVITE_REVOKED/)

    await expect(accept(tokenHash(), guest)).rejects.toThrow(/INVITE_NOT_FOUND/)
  })

  it('is not callable by signed-in users', async () => {
    await expect(
      asUser(db, host, (tx) =>
        tx.query(`select * from public.create_invitation($1, $2, '7 days', null)`, [
          host,
          tokenHash(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(db, guest, (tx) =>
        tx.query('select public.accept_invitation($1, $2)', [tokenHash(), guest]),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('create_meeting', () => {
  it('creates a meeting owned by the user with a random room name; service role only', async () => {
    const { rows } = await db.query<{ id: string }>('select public.create_meeting($1) id', [host])
    const { rows: meeting } = await db.query<{ owner_id: string; room_name: string }>(
      'select owner_id, room_name from public.meetings where id = $1',
      [rows[0]!.id],
    )
    expect(meeting[0]!.owner_id).toBe(host)
    expect(meeting[0]!.room_name).toMatch(/^m-[0-9a-f]{32}$/)
    await expect(
      asUser(db, host, (tx) => tx.query('select public.create_meeting($1)', [host])),
    ).rejects.toThrow(/permission denied/)
  })
})
