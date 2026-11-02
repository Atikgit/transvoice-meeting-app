import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { balances, createTestDb, createUser } from './harness'
import {
  addSponsoredGuest,
  connect,
  ledger,
  newCall,
  setCursor,
  setWindow,
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

/** A call whose host and guest are both admitted; the live window is set by each test. */
async function call() {
  const c = await newCall(db, host)
  await addSponsoredGuest(db, c, guest)
  return c
}

describe('apply_minute_tick bills only the live window (started_at .. ended_at)', () => {
  it('both connected for 60 s BEFORE Start, session ends right at Start: 0 minutes, no ledger rows', async () => {
    const c = await call()
    await setWindow(db, c, 60, 60)
    await connect(db, c, host, 0, 60)
    await connect(db, c, guest, 0, 60)

    const result = await tick(db, 120)

    expect(result).toMatchObject({ buckets: 2, rows: 0, minutes_debited: 0 })
    expect(await ledger(db)).toEqual([])
    expect(await balances(db, host)).toMatchObject({ trial: 15 })
  })

  it('both connected from 0 s, Start pressed at 60 s, talk until 180 s: 120 s = 2.0 minutes, not 3.0', async () => {
    const c = await call()
    await setWindow(db, c, 60, null)
    await connect(db, c, host, 0, 180)
    await connect(db, c, guest, 0, 180)

    await tick(db, 180)

    const rows = await ledger(db)
    expect(rows.map((r) => [r.seconds, r.billed])).toEqual([
      [60, 1],
      [60, 1],
    ])
    expect(await totalBilled(db, host)).toBe(2)
    expect(await balances(db, host)).toMatchObject({ trial: 13 })
  })

  it('the production case: connected at 33 s, Start at 38 s, end at 200 s = 162 s = 2.7 minutes (was 167 s)', async () => {
    const c = await call()
    await setWindow(db, c, 38, 200)
    await connect(db, c, host, 32, 200)
    await connect(db, c, guest, 33, 200)

    await tick(db, 240)

    const rows = await ledger(db)
    expect(rows.map((r) => r.seconds)).toEqual([22, 60, 60, 20]) // 38..60, full, full, 180..200
    expect(rows.map((r) => r.billed)).toEqual([0.3667, 1, 1, 0.3333])
    expect(rows.reduce((n, r) => n + r.seconds, 0)).toBe(162)
    expect(await totalBilled(db, host)).toBeCloseTo(2.7, 4)
  })

  it('a session that was never started (still ready) bills nothing however long both waited', async () => {
    const c = await call()
    await setWindow(db, c, null, null)
    await connect(db, c, host, 0, 600)
    await connect(db, c, guest, 0, 600)

    const result = await tick(db, 600)

    expect(result).toMatchObject({ buckets: 10, rows: 0, minutes_debited: 0 })
    expect(await balances(db, host)).toMatchObject({ trial: 15 })
  })

  it('time after ended_at bills nothing even if a segment is still open', async () => {
    const c = await call()
    await setWindow(db, c, 0, 90)
    await connect(db, c, host, 0, null, { heartbeat: 300 })
    await connect(db, c, guest, 0, null, { heartbeat: 300 })

    await tick(db, 300)

    const rows = await ledger(db)
    expect(rows.map((r) => r.seconds)).toEqual([60, 30]) // 0..60, 60..90 only
    expect(await totalBilled(db, host)).toBeCloseTo(1.5, 4)
  })

  it('a lone participant after Start still bills nothing; the overlap after the guest arrives does', async () => {
    const c = await call()
    await setWindow(db, c, 30, 180)
    await connect(db, c, host, 0, 180)
    await connect(db, c, guest, 90, 180) // alone from 30 to 90

    await tick(db, 180)

    const rows = await ledger(db)
    expect(rows.map((r) => r.seconds)).toEqual([30, 60]) // 90..120 and 120..180
    expect(await totalBilled(db, host)).toBeCloseTo(1.5, 4)
  })

  it('a bucket already in the ledger is never rewritten when the tick runs again', async () => {
    const c = await call()
    await setWindow(db, c, 0, 120)
    await connect(db, c, host, 0, 120)
    await connect(db, c, guest, 0, 120)
    await tick(db, 120)
    const before = await ledger(db)

    await setCursor(db, 0)
    const again = await tick(db, 120)

    expect(again).toMatchObject({ rows: 0, already_billed: 2 })
    expect(await ledger(db)).toEqual(before)
  })
})
