import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createTestDb, createUser } from './harness'
import { newCall } from './meter-world'

let db: PGlite
let payer: string
let other: string

beforeAll(async () => {
  db = await createTestDb()
  payer = await createUser(db, 'payer@example.com')
  other = await createUser(db, 'other@example.com')
}, 30_000)

const columns = async (table: string) =>
  (
    await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    )
  ).rows.map((r) => r.column_name)

describe('meter schema', () => {
  it('participant_segments has the heartbeat column', async () => {
    expect(await columns('participant_segments')).toContain('last_heartbeat_at')
  })

  it('usage_ledger has the audit columns and the idempotency key', async () => {
    expect(await columns('usage_ledger')).toEqual(
      expect.arrayContaining([
        'payer_id',
        'session_id',
        'participant_id',
        'minute_bucket',
        'lang_multiplier',
        'billed_minutes',
        'billing_type',
        'kind',
        'billable_seconds',
        'trial_debited',
        'subscription_debited',
        'shortfall_minutes',
      ]),
    )
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) def from pg_constraint
       where conname = 'usage_ledger_idempotency_key'`,
    )
    expect(rows[0]!.def).toBe('UNIQUE (session_id, participant_id, minute_bucket, kind)')
  })

  it('trial_debited / subscription_debited mirror the portions taken from each bucket', async () => {
    await db.query(
      `insert into public.usage_ledger (payer_id, billed_minutes, trial_minutes, prepaid_minutes,
                                        billing_type, kind, reason)
       values ($1, 5, 2, 3, 'prepaid', 'debit', 'probe')`,
      [payer],
    )
    const { rows } = await db.query<{ t: string; s: string }>(
      `select trial_debited t, subscription_debited s from public.usage_ledger where reason = 'probe'`,
    )
    expect(rows[0]).toEqual({ t: '2.0000', s: '3.0000' })
  })

  it('a user has at most one open segment per session', async () => {
    const { sessionId: session } = await newCall(db, payer)
    const insert = () =>
      db.query(
        `insert into public.participant_segments (session_id, user_id, payer_id, connected_at)
         values ($1, $2, $2, now())`,
        [session, payer],
      )
    await insert()
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i)
  })

  it('starts the billing cursor at migration time, one row only', async () => {
    const { rows } = await db.query<{ n: string; recent: boolean }>(
      `select count(*) n, bool_and(last_bucket_end > now() - interval '1 hour') recent
       from private.billing_cursor`,
    )
    expect(rows[0]).toEqual({ n: 1, recent: true })
    await expect(
      db.query(`insert into private.billing_cursor (id, last_bucket_end) values (false, now())`),
    ).rejects.toThrow()
  })
})

describe('meter privileges', () => {
  it('a payer reads only their own ledger rows', async () => {
    await db.query(
      `insert into public.usage_ledger (payer_id, billed_minutes, billing_type, kind, reason)
       values ($1, 1, 'free', 'debit', 'mine'), ($2, 1, 'free', 'debit', 'theirs')`,
      [payer, other],
    )
    const reasons = await asUser(db, payer, async (tx) => {
      const { rows } = await tx.query<{ reason: string }>(
        `select reason from public.usage_ledger where reason in ('mine', 'theirs')`,
      )
      return rows.map((r) => r.reason)
    })
    expect(reasons).toEqual(['mine'])
  })

  it('nobody writes ledger, segments or billing accounts from the client', async () => {
    for (const sql of [
      `insert into public.usage_ledger (payer_id, billed_minutes, billing_type, kind)
         values ('${payer}', -5, 'free', 'credit')`,
      `update public.usage_ledger set billed_minutes = 0`,
      `delete from public.usage_ledger`,
      `update public.participant_segments set last_heartbeat_at = now()`,
      `delete from public.participant_segments`,
      `update public.billing_accounts set trial_minutes_remaining = 9999 where user_id = '${payer}'`,
    ]) {
      await expect(asUser(db, payer, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/)
    }
  })

  it('the cursor and billing settings are invisible to clients; configure_billing is service role only', async () => {
    await expect(
      asUser(db, payer, (tx) => tx.query('select * from private.billing_cursor')),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(db, payer, (tx) => tx.query(`select public.configure_billing('per_payer', true)`)),
    ).rejects.toThrow(/permission denied/)
    await as(db, 'service_role', null, async (tx) => {
      await tx.query(`select public.configure_billing('per_participant', false)`)
      await tx.exec('reset role')
      const { rows } = await tx.query<{ key: string; value: unknown }>(
        `select key, value from private.app_settings
         where key in ('billing_basis', 'lang_multiplier_enabled') order by key`,
      )
      expect(rows).toEqual([
        { key: 'billing_basis', value: 'per_participant' },
        { key: 'lang_multiplier_enabled', value: false },
      ])
    })
    await expect(
      as(db, 'service_role', null, (tx) =>
        tx.query(`select public.configure_billing('bogus', true)`),
      ),
    ).rejects.toThrow(/INVALID_BILLING_BASIS/)
  })
})

describe('api_usage_events', () => {
  it('request_id is unique (a replay cannot count twice) and clients cannot read or write it', async () => {
    const insert = () =>
      db.query(
        `insert into public.api_usage_events (request_id, speech_seconds, target_lang)
         values ('utt:0:en-US', 2.5, 'en-US')`,
      )
    await insert()
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i)
    await expect(
      asUser(db, payer, (tx) => tx.query('select * from public.api_usage_events')),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(db, payer, (tx) =>
        tx.query(
          `insert into public.api_usage_events (request_id, speech_seconds) values ('x', 1)`,
        ),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})
