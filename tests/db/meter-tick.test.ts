import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { balances, createTestDb, createUser } from './harness'
import {
  addSponsoredGuest,
  connect,
  ledger,
  newCall,
  setCursor,
  tick,
  totalBilled,
} from './meter-world'

let db: PGlite
let host: string
let guest: string

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  await setCursor(db, 0)
}, 30_000)

describe('apply_minute_tick: the basics', () => {
  it('host sponsors a guest for 3 minutes: host 15 → 12, guest stays 15 (3 ledger rows of 1.0)', async () => {
    const call = await newCall(db, host)
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)

    const result = await tick(db, 180)

    expect(result).toMatchObject({
      buckets: 3,
      rows: 3,
      minutes_debited: 3,
      shortfall_minutes: 0,
      payers_touched: 1,
      basis: 'per_payer',
    })
    expect(await balances(db, host)).toMatchObject({ trial: 12, prepaid: 0 })
    expect(await balances(db, guest)).toMatchObject({ trial: 15, prepaid: 0 })
    const rows = await ledger(db)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => [r.payer_id, r.billed, r.seconds, r.lang_multiplier, r.kind])).toEqual(
      Array(3).fill([host, 1, 60, 1, 'debit']),
    )
  })

  it('a 10-minute 1:1 call with the host as sponsor debits exactly 10 minutes per_payer', async () => {
    const call = await newCall(db, host)
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, 600)
    await db.query(
      'update public.billing_accounts set trial_minutes_remaining = 100 where user_id = $1',
      [host],
    )

    const result = await tick(db, 600)

    expect(result.minutes_debited).toBe(10)
    expect(await totalBilled(db, host)).toBe(10)
    expect(await balances(db, host)).toMatchObject({ trial: 90 })
  })

  it('the same call debits 20 minutes with BILLING_BASIS=per_participant', async () => {
    await db.query(`select public.configure_billing('per_participant', true)`)
    const call = await newCall(db, host)
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, 600)
    await db.query(
      'update public.billing_accounts set trial_minutes_remaining = 100 where user_id = $1',
      [host],
    )

    const result = await tick(db, 600)

    expect(result).toMatchObject({ rows: 20, minutes_debited: 20, basis: 'per_participant' })
    expect(await totalBilled(db, host)).toBe(20)
    expect(await balances(db, host)).toMatchObject({ trial: 80 })
    expect(new Set((await ledger(db)).map((r) => r.participant_id))).toEqual(new Set([host, guest]))
  })
})
