import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import {
  asUser,
  balances,
  confirmEmail,
  createOAuthUserWithoutTriggers,
  createTestDb,
  createUser,
} from './harness'

let db: PGlite

beforeEach(async () => {
  db = await createTestDb()
}, 30_000)

const credit = (user: string, minutes: number, eventId: string, plan = 'bronze') =>
  db.query<{ ok: boolean }>(
    `select public.credit_minutes($1, $2, $3, 'subscription_payment_success', 2229952, $4) ok`,
    [user, minutes, eventId, plan],
  )

const debit = (
  user: string,
  minutes: number,
  key?: { session: string; participant: string; bucket: string },
) =>
  db.query<{ covered: string }>(`select public.debit_minutes($1, $2, 'test', $3, $4, $5) covered`, [
    user,
    minutes,
    key?.session ?? null,
    key?.participant ?? null,
    key?.bucket ?? null,
  ])

describe('signup and the free trial', () => {
  it('the SQL trial setting matches the app constant', async () => {
    const { rows } = await db.query<{ v: string }>(
      `select value::text v from private.app_settings where key = 'free_trial_minutes'`,
    )
    expect(Number(rows[0]!.v)).toBe(FREE_TRIAL_MINUTES)
  })

  it('creates a profile and billing account; verified signups get the trial', async () => {
    const user = await createUser(db, 'oauth@example.com', { fullName: 'OAuth User' })
    const { rows } = await db.query<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [user],
    )
    expect(rows[0]!.full_name).toBe('OAuth User')
    expect(await balances(db, user)).toMatchObject({
      trial: FREE_TRIAL_MINUTES,
      prepaid: 0,
      billingType: 'free',
    })
  })

  it('email signups get the trial only once the email is confirmed', async () => {
    const user = await createUser(db, 'pending@example.com', { confirmed: false })
    expect((await balances(db, user)).trial).toBe(0)
    await confirmEmail(db, user)
    expect((await balances(db, user)).trial).toBe(FREE_TRIAL_MINUTES)
  })

  it('grants one trial per normalized email, even after the account is deleted', async () => {
    const first = await createUser(db, 'Some.One@gmail.com')
    expect((await balances(db, first)).trial).toBe(FREE_TRIAL_MINUTES)
    await db.query('delete from auth.users where id = $1', [first])

    const again = await createUser(db, 'someone+promo@googlemail.com')
    expect((await balances(db, again)).trial).toBe(0)
  })

  it('treats different addresses as different trials', async () => {
    const a = await createUser(db, 'a+x@example.com')
    const b = await createUser(db, 'a.b@example.com')
    expect((await balances(db, a)).trial).toBe(FREE_TRIAL_MINUTES)
    expect((await balances(db, b)).trial).toBe(FREE_TRIAL_MINUTES)
  })
})

describe('ensure_user_account (called on every sign-in)', () => {
  const ensure = (user: string) =>
    db.query<{ granted: boolean }>('select public.ensure_user_account($1) granted', [user])

  it('creates the missing account and grants the trial to a verified OAuth identity', async () => {
    for (const provider of ['google', 'linkedin_oidc'] as const) {
      const user = await createOAuthUserWithoutTriggers(db, `${provider}@example.com`, provider)
      expect((await ensure(user)).rows[0]!.granted).toBe(true)
      expect(await balances(db, user)).toMatchObject({ trial: FREE_TRIAL_MINUTES, prepaid: 0 })
    }
  })

  it('is idempotent and never grants twice', async () => {
    const user = await createUser(db, 'repeat@example.com')
    expect((await ensure(user)).rows[0]!.granted).toBe(false)
    expect((await ensure(user)).rows[0]!.granted).toBe(false)
    expect((await balances(db, user)).trial).toBe(FREE_TRIAL_MINUTES)
  })

  it('does not grant to an unconfirmed email signup', async () => {
    const user = await createUser(db, 'unconfirmed@example.com', { confirmed: false })
    expect((await ensure(user)).rows[0]!.granted).toBe(false)
    expect((await balances(db, user)).trial).toBe(0)
  })

  it('respects the once-per-normalized-email rule across providers', async () => {
    await createUser(db, 'Same.Person@gmail.com')
    const oauth = await createOAuthUserWithoutTriggers(db, 'sameperson+x@gmail.com', 'google')
    expect((await ensure(oauth)).rows[0]!.granted).toBe(false)
    expect((await balances(db, oauth)).trial).toBe(0)
  })

  it('is not callable by signed-in users', async () => {
    const user = await createUser(db, 'caller@example.com')
    await expect(
      asUser(db, user, (tx) => tx.query('select public.ensure_user_account($1)', [user])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('has_available_minutes', () => {
  it('is true with trial minutes, false at zero', async () => {
    const user = await createUser(db, 'avail@example.com')
    const check = async () =>
      (await db.query<{ ok: boolean }>('select public.has_available_minutes($1) ok', [user]))
        .rows[0]!.ok
    expect(await check()).toBe(true)
    await debit(user, FREE_TRIAL_MINUTES)
    expect(await check()).toBe(false)
  })

  it('is false for an unknown user', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select public.has_available_minutes('00000000-0000-0000-0000-000000000000') ok`,
    )
    expect(rows[0]!.ok).toBe(false)
  })
})

describe('debit_minutes', () => {
  it('uses subscription minutes before trial minutes', async () => {
    const user = await createUser(db, 'order@example.com')
    await credit(user, 120, 'evt-1')
    await debit(user, 118)
    expect(await balances(db, user)).toMatchObject({ prepaid: 2, trial: FREE_TRIAL_MINUTES })
    await debit(user, 5)
    expect(await balances(db, user)).toMatchObject({ prepaid: 0, trial: FREE_TRIAL_MINUTES - 3 })
  })

  it('never goes negative and reports the covered amount', async () => {
    const user = await createUser(db, 'short@example.com')
    const { rows } = await debit(user, FREE_TRIAL_MINUTES + 10)
    expect(Number(rows[0]!.covered)).toBe(FREE_TRIAL_MINUTES)
    expect((await balances(db, user)).trial).toBe(0)
  })

  it('is idempotent for the same session/participant/minute bucket', async () => {
    const user = await createUser(db, 'tick@example.com')
    const { rows } = await db.query<{ session: string }>(`
      with m as (insert into public.meetings (owner_id, room_name) values ('${user}', 'r1') returning id)
      insert into public.call_sessions (meeting_id, host_id, initiated_by, status)
      select id, '${user}', '${user}', 'live' from m returning id as session
    `)
    const key = { session: rows[0]!.session, participant: user, bucket: '2026-10-22T10:00:00Z' }
    await debit(user, 1, key)
    const rerun = await debit(user, 1, key)
    expect(Number(rerun.rows[0]!.covered)).toBe(0)
    expect((await balances(db, user)).trial).toBe(FREE_TRIAL_MINUTES - 1)
  })
})

describe('credit_minutes (prepaid subscription periods)', () => {
  it('credits a plan once per event id', async () => {
    const user = await createUser(db, 'pay@example.com')
    expect((await credit(user, 120, 'evt-dup')).rows[0]!.ok).toBe(true)
    expect((await credit(user, 120, 'evt-dup')).rows[0]!.ok).toBe(false)
    expect(await balances(db, user)).toMatchObject({
      prepaid: 120,
      billingType: 'prepaid',
      plan: 'bronze',
    })
  })

  it('resets unused subscription minutes at renewal and keeps trial minutes', async () => {
    const user = await createUser(db, 'renew@example.com')
    await credit(user, 120, 'evt-initial')
    await debit(user, 20) // 100 prepaid left, trial untouched
    await credit(user, 120, 'evt-renewal')
    expect(await balances(db, user)).toMatchObject({ prepaid: 120, trial: FREE_TRIAL_MINUTES })

    const { rows } = await db.query<{ kind: string; billed: string }>(
      `select kind, billed_minutes billed from public.usage_ledger
       where payer_id = $1 and kind = 'expire'`,
      [user],
    )
    expect(rows).toEqual([{ kind: 'expire', billed: '100.0000' }])
  })

  it('switches the plan allotment on upgrade', async () => {
    const user = await createUser(db, 'upgrade@example.com')
    await credit(user, 120, 'evt-a', 'bronze')
    await credit(user, 600, 'evt-b', 'business')
    expect(await balances(db, user)).toMatchObject({ prepaid: 600, plan: 'business' })
  })
})
