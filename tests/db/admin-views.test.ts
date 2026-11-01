import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { as, asUser, createTestDb, createUser } from './harness'
import { addSponsoredGuest, connect, newCall, setCursor, tick } from './meter-world'

let db: PGlite
let host: string
let guest: string
let session: string

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  await setCursor(db, 0)
  const call = await newCall(db, host)
  session = call.sessionId
  await addSponsoredGuest(db, call, guest)
  await connect(db, call, host, 0, 180)
  await connect(db, call, guest, 0, 180)
  await tick(db, 180)
}, 30_000)

const asService = <T>(sql: string) =>
  as(db, 'service_role', null, async (tx) => (await tx.query<T>(sql)).rows)

describe('admin.session_costs', () => {
  it('billed minutes against API speech seconds x languages (3.0 min billed vs 2 x 45 s = 90 s)', async () => {
    await db.query(
      `insert into public.api_usage_events (request_id, session_id, speaker_id, target_lang, speech_seconds)
       values ('u1:0:en-US', $1, $2, 'en-US', 45), ('u1:0:es-ES', $1, $2, 'es-ES', 45)`,
      [session, host],
    )
    const [row] = await asService<Record<string, string | number>>(
      `select * from admin.session_costs where session_id = '${session}'`,
    )
    expect(Number(row!.billed_minutes)).toBe(3)
    expect(Number(row!.billable_seconds)).toBe(180)
    expect(Number(row!.api_speech_seconds)).toBe(90)
    expect(Number(row!.api_calls)).toBe(2)
    expect(Number(row!.target_languages)).toBe(2)
    expect(Number(row!.payers)).toBe(1)
    expect(Number(row!.billed_per_api_second)).toBe(2) // 180 s billed / 90 s processed
  })

  it('a session without API usage still shows its billing (ratio is null, not an error)', async () => {
    const [row] = await asService<Record<string, string | null>>(
      `select * from admin.session_costs where session_id = '${session}'`,
    )
    expect(Number(row!.billed_minutes)).toBe(3)
    expect(row!.billed_per_api_second).toBeNull()
  })
})

describe('admin.billing_reconciliation', () => {
  it('the ledger explains the balance: host 15 credit - 3 debit = 12, difference 0; guest untouched', async () => {
    const rows = await asService<Record<string, string>>(
      `select * from admin.billing_reconciliation where payer_id in ('${host}', '${guest}')`,
    )
    const of = (id: string) => rows.find((r) => r.payer_id === id)!
    expect(Number(of(host).balance)).toBe(12)
    expect(Number(of(host).ledger_credits)).toBe(15)
    expect(Number(of(host).ledger_debits)).toBe(3)
    expect(Number(of(host).expected_balance)).toBe(12)
    expect(Number(of(host).difference)).toBe(0)
    expect(Number(of(guest).balance)).toBe(15)
    expect(Number(of(guest).difference)).toBe(0)
  })

  it('shows a balance that the ledger does not explain (5 minutes removed by hand → difference -5)', async () => {
    await db.query(
      'update public.billing_accounts set trial_minutes_remaining = trial_minutes_remaining - 5 where user_id = $1',
      [host],
    )
    const [row] = await asService<Record<string, string>>(
      `select difference from admin.billing_reconciliation where payer_id = '${host}'`,
    )
    expect(Number(row!.difference)).toBe(-5)
  })
})

describe('admin schema privileges', () => {
  it.each(['session_costs', 'billing_reconciliation'])(
    'anon and signed-in users cannot read admin.%s',
    async (view) => {
      await expect(
        asUser(db, host, (tx) => tx.query(`select * from admin.${view}`)),
      ).rejects.toThrow(/permission denied/)
      await expect(
        as(db, 'anon', null, (tx) => tx.query(`select * from admin.${view}`)),
      ).rejects.toThrow(/permission denied/)
    },
  )

  it('nothing in schema admin is granted to anon or authenticated, and nothing admin is in public', async () => {
    const grants = await db.query(
      `select grantee, table_name from information_schema.role_table_grants
       where table_schema = 'admin' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    )
    expect(grants.rows).toEqual([])
    const leaked = await db.query(
      `select table_name from information_schema.views
       where table_schema = 'public' and table_name in ('session_costs', 'billing_reconciliation')`,
    )
    expect(leaked.rows).toEqual([])
  })
})
