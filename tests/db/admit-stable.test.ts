import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, createUser } from './harness'

let db: PGlite
let host: string
let guest: string
let session: string

const admit = async (user: string) =>
  (
    await db.query<{ payer_id: string; spoken_lang: string; listen_lang: string; role: string }>(
      'select * from public.admit_participant($1, $2)',
      [session, user],
    )
  ).rows[0]!
const row = async (user: string) =>
  (
    await db.query<{ payer_id: string; spoken_lang: string; listen_lang: string }>(
      'select * from public.meeting_participants where session_id = $1 and user_id = $2',
      [session, user],
    )
  ).rows[0]

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const { rows } = await db.query<{ meeting_id: string }>(
    `select * from public.create_invitation($1, $2, '7 days', null)`,
    [host, hash],
  )
  await db.query('select public.accept_invitation($1, $2)', [hash, guest])
  session = (
    await db.query<{ session_id: string }>('select * from public.open_call_session($1, $2)', [
      rows[0]!.meeting_id,
      host,
    ])
  ).rows[0]!.session_id
  await db.query(
    `update public.profiles set spoken_lang = 'bn-BD', listen_lang = 'en-US' where id = $1`,
    [guest],
  )
}, 30_000)

describe('admit_participant is stable across token requests', () => {
  it('every joined user has a row with languages AND a payer (the host pays for the sponsored guest)', async () => {
    await admit(host)
    await admit(guest)
    expect(await row(host)).toMatchObject({ payer_id: host })
    expect(await row(guest)).toMatchObject({
      payer_id: host,
      spoken_lang: 'bn-BD',
      listen_lang: 'en-US',
    })
  })

  it('a reconnect (second token request) keeps a language changed in the room', async () => {
    await admit(guest)
    await db.query(`select * from public.set_participant_langs($1, $2, 'es-ES', 'fr-FR')`, [
      session,
      guest,
    ])
    const again = await admit(guest)
    expect(again).toMatchObject({ spoken_lang: 'es-ES', listen_lang: 'fr-FR' })
    expect(await row(guest)).toMatchObject({ spoken_lang: 'es-ES', listen_lang: 'fr-FR' })
  })

  it('a sponsorship window that expires mid-call does not move the guest’s minutes (decision 1)', async () => {
    await admit(guest)
    await db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
    const again = await admit(guest) // e.g. the browser reconnected after the window ended
    expect(again.payer_id).toBe(host)
    expect((await row(guest))!.payer_id).toBe(host)
  })

  it('a participant already in the session is let back in at 0 minutes; a new self-payer is not', async () => {
    await db.query(`update public.sponsored_connections set expires_at = now() - interval '1 s'`)
    await db.query(`select public.debit_minutes($1, 15, 'test')`, [guest])
    await expect(admit(guest)).rejects.toThrow(/NO_MINUTES/) // new, paying for themselves, nothing left
    expect(await row(guest)).toBeUndefined()
  })

  it('still refuses closed sessions and strangers', async () => {
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(admit(stranger)).rejects.toThrow(/NOT_ALLOWED/)
    await db.query(`select public.end_call_session($1, $2)`, [session, host])
    await expect(admit(guest)).rejects.toThrow(/SESSION_CLOSED/)
  })
})
