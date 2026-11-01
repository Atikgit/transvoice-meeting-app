import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { balances, createTestDb, createUser } from './harness'
import {
  addGuestOf,
  addSelfPayer,
  addSponsoredGuest,
  at,
  connect,
  ledger,
  newCall,
  setCursor,
  setLangs,
  tick,
  totalBilled,
  type Call,
} from './meter-world'

/**
 * Every case of the minute meter with explicit numbers. Time is in seconds from T0; bucket n is
 * [60n, 60n + 60). Unless a test says otherwise the default basis is per_payer, 15 trial minutes.
 */
let db: PGlite
let host: string
let guest: string
let third: string
let call: Call

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  third = await createUser(db, 'third@example.com')
  await setCursor(db, 0)
  call = await newCall(db, host)
}, 30_000)

const setBalance = (user: string, trial: number, prepaid = 0) =>
  db.query(
    'update public.billing_accounts set trial_minutes_remaining = $2, prepaid_minutes_remaining = $3 where user_id = $1',
    [user, trial, prepaid],
  )
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

describe('a. sponsored guest', () => {
  it('connected 3 minutes with the host: the sponsor pays 3.0, the guest keeps 15', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
    await tick(db, 180)
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
    expect(await balances(db, guest)).toMatchObject({ trial: 15 })
    expect((await ledger(db)).every((r) => r.payer_id === host)).toBe(true)
  })

  it('per_participant: the sponsor pays 6.0 (3 for each person), the guest still keeps 15', async () => {
    await db.query(`select public.configure_billing('per_participant', true)`)
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
    await tick(db, 180)
    expect(await balances(db, host)).toMatchObject({ trial: 9 })
    expect(await balances(db, guest)).toMatchObject({ trial: 15 })
  })

  it('two people who each pay for themselves: 1.0 each per minute, 3.0 each after 3 minutes', async () => {
    await addSelfPayer(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
    const result = await tick(db, 180)
    expect(result).toMatchObject({ rows: 6, payers_touched: 2 })
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
    expect(await balances(db, guest)).toMatchObject({ trial: 12 })
  })
})

describe('b. a person invited by the guest', () => {
  it('is billed to the guest: host 12 (host + guest), guest 12 (for the third person), third 15', async () => {
    await addSponsoredGuest(db, call, guest)
    await addGuestOf(db, call, guest, third)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
    await connect(db, call, third, 0, 180)
    const result = await tick(db, 180)
    expect(result).toMatchObject({ rows: 6, payers_touched: 2, minutes_debited: 6 })
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
    expect(await balances(db, guest)).toMatchObject({ trial: 12 })
    expect(await balances(db, third)).toMatchObject({ trial: 15 })
    expect(await totalBilled(db, host)).toBe(3) // not 6: the host does not pay for the guest's guest
    expect(await totalBilled(db, guest)).toBe(3)
  })
})

describe('c. nothing to bill', () => {
  it('a lone participant for 5 minutes bills 0 (15 stays 15), even with a live session', async () => {
    await connect(db, call, host, 0, 300)
    const result = await tick(db, 300)
    expect(result).toMatchObject({ buckets: 5, rows: 0, minutes_debited: 0 })
    expect(await balances(db, host)).toMatchObject({ trial: 15 })
    expect(await ledger(db)).toEqual([])
  })

  it.each(['ringing', 'declined', 'missed'])('a %s call bills 0', async (status) => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 300) // the caller waits alone
    await db.query(`update public.call_sessions set status = $2 where id = $1`, [
      call.sessionId,
      status,
    ])
    await tick(db, 300)
    expect(await ledger(db)).toEqual([])
    expect(await balances(db, host)).toMatchObject({ trial: 15 })
    expect(await balances(db, guest)).toMatchObject({ trial: 15 })
  })
})

describe('d. gaps and partial minutes', () => {
  it('a disconnect gap is not billed: guest 0:20-1:00 and 2:30-3:30 with the host all 5 minutes → 40 s + 30 s + 30 s = 1.6667', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 300)
    await connect(db, call, guest, 20, 60)
    await connect(db, call, guest, 150, 210)
    await tick(db, 300)
    expect((await ledger(db)).map((r) => [r.seconds, r.billed])).toEqual([
      [40, 0.6667], // joined 20 s into the first minute
      [30, 0.5], // back at 2:30, minute 2:00-3:00
      [30, 0.5], // left at 3:30, minute 3:00-4:00
    ])
    expect(round4(await totalBilled(db, host))).toBe(1.6667)
    expect((await balances(db, host)).trial).toBeCloseTo(15 - 1.6667, 4)
  })

  it('a participant who joins 45 s into the minute and leaves after 15 s pays 15/60 = 0.25', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 60)
    await connect(db, call, guest, 45, 60)
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.seconds, r.billed])).toEqual([[15, 0.25]])
  })

  it('the sponsor and guest never connected at the same time: 0', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 30)
    await connect(db, call, guest, 30, 60)
    await tick(db, 60)
    expect(await ledger(db)).toEqual([])
  })
})

describe('e. language multiplier', () => {
  /** Host, a guest of the host and a third person of the host, all connected for minute 0. */
  const room = async (langs: [string, string][]) => {
    const people = [host, guest, third]
    await addSponsoredGuest(db, call, guest)
    await addGuestOf(db, call, host, third) // same payer: the host
    for (const [i, user] of people.entries()) {
      await setLangs(db, call, user, langs[i]![0], langs[i]![1])
      await connect(db, call, user, 0, 60)
    }
  }

  it('1:1 bn <-> en: L = 1, one minute bills 1.0', async () => {
    await addSponsoredGuest(db, call, guest)
    await setLangs(db, call, host, 'bn-BD', 'bn-BD')
    await setLangs(db, call, guest, 'en-US', 'en-US')
    await connect(db, call, host, 0, 60)
    await connect(db, call, guest, 0, 60)
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[1, 1]])
  })

  it('one foreign listener language (bn speaker, listeners bn + en): L = 1 → 1.0', async () => {
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['bn-IN', 'bn-IN'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[1, 1]])
  })

  it('two foreign listener languages (bn speaker, listeners en + es): L = 2 → 2.0', async () => {
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['es-ES', 'es-ES'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[2, 2]])
    expect(await balances(db, host)).toMatchObject({ trial: 13 })
  })

  it('everyone on the same language (en-US, en-GB, en-AU): L = 1 → 1.0', async () => {
    await room([
      ['en-US', 'en-US'],
      ['en-GB', 'en-GB'],
      ['en-AU', 'en-AU'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[1, 1]])
  })

  it('L is the largest need of any single speaker, not the average: needs of 2, 2 and 1 → per_payer 2.0', async () => {
    // host speaks bn, listens bn; guest speaks en, listens en; third speaks en, listens es.
    // host: listeners en + es → 2. guest: listeners bn + es → 2. third: listeners bn (en is its own) → 1.
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['en-US', 'es-ES'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[2, 2]])
  })

  it('the same room per_participant: each speaker pays their own need, 2 + 2 + 1 = 5.0', async () => {
    await db.query(`select public.configure_billing('per_participant', true)`)
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['en-US', 'es-ES'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => r.billed).sort()).toEqual([1, 2, 2])
    expect(await balances(db, host)).toMatchObject({ trial: 10 })
  })

  it('per_participant: each speaker has their own L (bn/en/es room: 2 + 2 + 2 minutes = 6.0)', async () => {
    await db.query(`select public.configure_billing('per_participant', true)`)
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['es-ES', 'es-ES'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
    ])
    expect(await balances(db, host)).toMatchObject({ trial: 9 })
  })

  it('per_participant asymmetric: bn / en / en → 1 + 1 + 1 = 3.0 (listeners of the same language count once)', async () => {
    await db.query(`select public.configure_billing('per_participant', true)`)
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['en-US', 'en-US'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => r.lang_multiplier)).toEqual([1, 1, 1])
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
  })

  it('LANG_MULTIPLIER_ENABLED=false: a 3-language room bills 1.0', async () => {
    await db.query(`select public.configure_billing('per_payer', false)`)
    await room([
      ['bn-BD', 'bn-BD'],
      ['en-US', 'en-US'],
      ['es-ES', 'es-ES'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => [r.lang_multiplier, r.billed])).toEqual([[1, 1]])
  })

  it('Chinese: traditional and simplified are different languages (zh-TW speaker, zh-CN + en listeners → L 2)', async () => {
    await room([
      ['zh-TW', 'zh-TW'],
      ['zh-CN', 'zh-CN'],
      ['en-US', 'en-US'],
    ])
    await tick(db, 60)
    expect((await ledger(db)).map((r) => r.lang_multiplier)).toEqual([2])
  })
})

describe('f. idempotency and concurrency', () => {
  beforeEach(async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
  })

  it('running the tick twice writes one set of rows (3 rows, host 12)', async () => {
    expect(await tick(db, 180)).toMatchObject({ rows: 3, buckets: 3 })
    expect(await tick(db, 180)).toMatchObject({ rows: 0, buckets: 0 })
    expect(await ledger(db)).toHaveLength(3)
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
  })

  it('even with the cursor moved back, the ledger key blocks double billing (3 already billed, 0 new)', async () => {
    await tick(db, 180)
    await setCursor(db, 0)
    expect(await tick(db, 180)).toMatchObject({ rows: 0, already_billed: 3, minutes_debited: 0 })
    expect(await ledger(db)).toHaveLength(3)
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
  })

  it('two ticks started together produce one set of rows (3 rows in total, host 12)', async () => {
    const results = await Promise.all([tick(db, 180), tick(db, 180)])
    expect(results.reduce((sum, r) => sum + (r.rows ?? 0), 0)).toBe(3)
    expect(await ledger(db)).toHaveLength(3)
    expect(await balances(db, host)).toMatchObject({ trial: 12 })
  })
})

describe('g. debit order and shortfall', () => {
  beforeEach(async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 300)
    await connect(db, call, guest, 0, 300)
  })

  it('subscription minutes first: 2 subscription + 15 trial, 5-minute call → subscription 0, trial 12', async () => {
    await setBalance(host, 15, 2)
    await tick(db, 300)
    expect((await ledger(db)).map((r) => [r.sub, r.trial])).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
      [0, 1],
    ])
    expect(await balances(db, host)).toMatchObject({ trial: 12, prepaid: 0 })
  })

  it('never below zero, shortfall recorded: 0.5 subscription + 1 trial, 5-minute call → covers 1.5, short 3.5', async () => {
    await setBalance(host, 1, 0.5)
    const result = await tick(db, 300)
    expect(result).toMatchObject({
      minutes_debited: 1.5,
      shortfall_minutes: 3.5,
      payers_depleted: 1,
    })
    expect(await balances(db, host)).toMatchObject({ trial: 0, prepaid: 0 })
    expect((await ledger(db)).map((r) => [r.billed, r.sub, r.trial, r.shortfall])).toEqual([
      [1, 0.5, 0.5, 0],
      [0.5, 0, 0.5, 0.5],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ])
  })

  it('a payer with 0 minutes stays at 0 and every minute is recorded as shortfall (5.0)', async () => {
    await setBalance(host, 0, 0)
    expect(await tick(db, 300)).toMatchObject({ minutes_debited: 0, shortfall_minutes: 5 })
    expect(await balances(db, host)).toMatchObject({ trial: 0, prepaid: 0 })
  })
})

describe('h. postpaid', () => {
  beforeEach(async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 180)
    await connect(db, call, guest, 0, 180)
  })
  const postpaid = (limit: number | null) =>
    db.query(
      `update public.billing_accounts set billing_type = 'postpaid', postpaid_credit_limit_minutes = $2
       where user_id = $1`,
      [host, limit],
    )
  const available = async () =>
    (await db.query<{ ok: boolean }>('select public.has_available_minutes($1) ok', [host])).rows[0]!
      .ok

  it('accrues 3.0 minutes in postpaid_minutes_accrued and leaves the trial minutes alone', async () => {
    await postpaid(10)
    const result = await tick(db, 180)
    expect(result).toMatchObject({ minutes_accrued: 3, minutes_debited: 0 })
    expect(await balances(db, host)).toMatchObject({ accrued: 3, trial: 15 })
    expect((await ledger(db)).map((r) => r.kind)).toEqual(['accrual', 'accrual', 'accrual'])
    expect(await available()).toBe(true) // 3 < 10
  })

  it('past the credit limit (3.0 accrued, limit 2.5) the payer has no available minutes', async () => {
    await postpaid(2.5)
    expect(await available()).toBe(true)
    expect(await tick(db, 180)).toMatchObject({ minutes_accrued: 3, payers_depleted: 1 })
    expect(await available()).toBe(false)
  })

  it('no limit: always available', async () => {
    await postpaid(null)
    await tick(db, 180)
    expect(await available()).toBe(true)
  })
})

describe('i. crashed tab', () => {
  it('no heartbeat after 1:40: the guest stops being billed at 2:25 (60 + 60 + 25 s = 2.4167, not 5.0)', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, null, { heartbeat: 100 }) // never closed
    await tick(db, 300)
    expect((await ledger(db)).map((r) => [r.seconds, r.billed])).toEqual([
      [60, 1],
      [60, 1],
      [25, 0.4167],
    ])
    expect(round4(await totalBilled(db, host))).toBe(2.4167)
  })

  it('a tab that keeps heartbeating (last at 4:50) is billed the whole 5 minutes', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, null, { heartbeat: 290 })
    await tick(db, 300)
    expect(await totalBilled(db, host)).toBe(5)
  })

  it('a heartbeat exactly 45 s old still covers the bucket end: last heartbeat 0:15 → billed to 1:00', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, null, { heartbeat: 15 })
    await tick(db, 120)
    expect((await ledger(db)).map((r) => r.seconds)).toEqual([60])
  })
})

describe('j. downtime catch-up', () => {
  it('cursor 10 minutes behind: all 10 buckets are processed once (host 100 → 90)', async () => {
    await addSponsoredGuest(db, call, guest)
    await setBalance(host, 100)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, 600)
    expect(await tick(db, 600)).toMatchObject({ buckets: 10, rows: 10, minutes_debited: 10 })
    expect(await tick(db, 600)).toMatchObject({ buckets: 0, rows: 0 })
    expect(await balances(db, host)).toMatchObject({ trial: 90 })
    expect(new Set((await ledger(db)).map((r) => r.minute_bucket)).size).toBe(10)
  })

  it('a 125-minute backlog takes two runs: 120 buckets, then 5, then nothing', async () => {
    await addSponsoredGuest(db, call, guest)
    await setBalance(host, 200)
    await connect(db, call, host, 0, 125 * 60)
    await connect(db, call, guest, 0, 125 * 60)
    expect(await tick(db, 125 * 60)).toMatchObject({ buckets: 120, rows: 120 })
    expect(await tick(db, 125 * 60)).toMatchObject({ buckets: 5, rows: 5 })
    expect(await tick(db, 125 * 60)).toMatchObject({ buckets: 0, rows: 0 })
    expect(await balances(db, host)).toMatchObject({ trial: 75 })
  })

  it('only closed buckets are processed: until 2:30 bills minutes 0 and 1, the cursor stops at 2:00', async () => {
    await addSponsoredGuest(db, call, guest)
    await connect(db, call, host, 0, 600)
    await connect(db, call, guest, 0, 600)
    expect(await tick(db, 150)).toMatchObject({ buckets: 2, rows: 2 })
    const { rows } = await db.query<{ c: string }>(
      'select last_bucket_end c from private.billing_cursor',
    )
    expect(new Date(rows[0]!.c).toISOString()).toBe(at(120))
  })
})

describe('k. a session that ended mid-bucket', () => {
  beforeEach(async () => {
    await addSponsoredGuest(db, call, guest)
  })

  it('bills its final partial bucket on the next tick: ended at 1:30 → 1.0 then 0.5', async () => {
    await connect(db, call, host, 0, 90)
    await connect(db, call, guest, 0, 90)
    await db.query(
      `update public.call_sessions set status = 'ended', ended_at = $2 where id = $1`,
      [call.sessionId, at(90)],
    )
    expect(await tick(db, 60)).toMatchObject({ rows: 1, minutes_debited: 1 })
    expect(await tick(db, 120)).toMatchObject({ rows: 1, minutes_debited: 0.5 })
    expect(await tick(db, 180)).toMatchObject({ rows: 0 })
    expect(await balances(db, host)).toMatchObject({ trial: 13.5 })
  })

  it('segments left open when the session ended close at their last heartbeat (1:25) → 60 s + 25 s', async () => {
    await connect(db, call, host, 0, null, { heartbeat: 85 })
    await connect(db, call, guest, 0, null, { heartbeat: 85 })
    await db.query(
      `update public.call_sessions set status = 'ended', ended_at = $2 where id = $1`,
      [call.sessionId, at(90)],
    )
    await tick(db, 180)
    expect((await ledger(db)).map((r) => [r.seconds, r.billed])).toEqual([
      [60, 1],
      [25, 0.4167],
    ])
  })
})

describe('n. payers with several people', () => {
  it('the sponsor and guest (one payer) plus a self-payer: the payer is charged once per minute, the self-payer for their overlap', async () => {
    await addSponsoredGuest(db, call, guest)
    await addSelfPayer(db, call, third)
    await connect(db, call, host, 0, 60)
    await connect(db, call, guest, 0, 30)
    await connect(db, call, third, 30, 60)
    await tick(db, 60)
    // host: overlaps the guest 0-30 and the third person 30-60 → the whole minute.
    // third: overlaps the host 30-60 → 30 s.
    const rows = await ledger(db)
    expect(rows.find((r) => r.payer_id === host)).toMatchObject({ seconds: 60, billed: 1 })
    expect(rows.find((r) => r.payer_id === third)).toMatchObject({ seconds: 30, billed: 0.5 })
    expect(rows).toHaveLength(2)
    expect(await balances(db, guest)).toMatchObject({ trial: 15 })
  })
})
