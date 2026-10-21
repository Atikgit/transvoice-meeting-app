import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, asUser, createTestDb, createUser } from './harness'

let db: PGlite
let alice: string
let bob: string
let carol: string

beforeAll(async () => {
  db = await createTestDb()
  alice = await createUser(db, 'alice@example.com', { fullName: 'Alice' })
  bob = await createUser(db, 'bob@example.com', { fullName: 'Bob' })
  carol = await createUser(db, 'carol@example.com', { fullName: 'Carol' })
  // Alice and Bob are connected (e.g. via an accepted invitation); Carol is a stranger.
  await db.exec(`
    insert into public.connections (user_id, contact_id) values
      ('${alice}', '${bob}'), ('${bob}', '${alice}');
  `)
}, 30_000)

// table → a column to touch in the UPDATE probe
const BILLING_TABLES = {
  billing_accounts: 'plan',
  usage_ledger: 'reason',
  participant_segments: 'last_heartbeat_at',
  payment_events: 'event_name',
}

describe('profiles', () => {
  it('a user reads their own profile and their connections, not strangers', async () => {
    const ids = await asUser(db, alice, async (tx) => {
      const { rows } = await tx.query<{ id: string }>('select id from public.profiles')
      return rows.map((r) => r.id)
    })
    expect(ids.sort()).toEqual([alice, bob].sort())
    expect(ids).not.toContain(carol)
  })

  it('a user updates the editable columns of their own profile', async () => {
    const row = await asUser(db, alice, async (tx) => {
      await tx.query(
        `update public.profiles set headline = 'Founder', spoken_lang = 'bn-BD' where id = $1`,
        [alice],
      )
      const { rows } = await tx.query<{ headline: string; spoken_lang: string }>(
        'select headline, spoken_lang from public.profiles where id = $1',
        [alice],
      )
      return rows[0]
    })
    expect(row).toEqual({ headline: 'Founder', spoken_lang: 'bn-BD' })
  })

  it("a user cannot update someone else's profile", async () => {
    const affected = await asUser(db, alice, async (tx) => {
      const result = await tx.query(
        `update public.profiles set headline = 'hacked' where id = $1`,
        [bob],
      )
      return result.affectedRows
    })
    expect(affected).toBe(0)
  })

  it('a user cannot change protected profile columns', async () => {
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(`update public.profiles set avatar_url = 'https://evil' where id = $1`, [alice]),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('a user cannot insert or delete profiles', async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query(`delete from public.profiles where id = $1`, [alice])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('billing tables', () => {
  it('a user reads only their own billing account and ledger', async () => {
    const result = await asUser(db, alice, async (tx) => {
      const accounts = await tx.query<{ user_id: string }>(
        'select user_id from public.billing_accounts',
      )
      const ledger = await tx.query<{ payer_id: string }>(
        'select payer_id from public.usage_ledger',
      )
      return { accounts: accounts.rows, ledger: ledger.rows }
    })
    expect(result.accounts).toEqual([{ user_id: alice }])
    expect(result.ledger.every((r) => r.payer_id === alice)).toBe(true)
    expect(result.ledger.length).toBeGreaterThan(0) // the trial credit
  })

  it.each(Object.entries(BILLING_TABLES))('a user cannot write %s', async (table, column) => {
    for (const sql of [
      `insert into public.${table} default values`,
      `update public.${table} set ${column} = ${column}`,
      `delete from public.${table}`,
    ]) {
      await expect(asUser(db, alice, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/)
    }
  })

  it('a user cannot give themselves minutes through the billing functions', async () => {
    for (const sql of [
      `select public.credit_minutes('${alice}', 600, 'evt', 'x', 1, 'business')`,
      `select public.debit_minutes('${bob}', 5, 'x')`,
      `select public.has_available_minutes('${bob}')`,
      `select private.grant_trial('${alice}', 'new@example.com')`,
    ]) {
      await expect(asUser(db, alice, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/)
    }
  })

  it('payment events and api usage are hidden from clients', async () => {
    for (const table of ['payment_events', 'api_usage_events']) {
      await expect(
        asUser(db, alice, (tx) => tx.query(`select * from public.${table}`)),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('private settings and trial grants are hidden from clients', async () => {
    for (const table of ['private.app_settings', 'private.trial_grants']) {
      await expect(asUser(db, alice, (tx) => tx.query(`select * from ${table}`))).rejects.toThrow(
        /permission denied/,
      )
    }
  })
})

describe('anonymous access', () => {
  it('anon can read nothing', async () => {
    for (const table of ['profiles', 'billing_accounts', 'meetings', 'chat_messages']) {
      await expect(
        as(db, 'anon', null, (tx) => tx.query(`select * from public.${table}`)),
      ).rejects.toThrow(/permission denied/)
    }
  })
})

describe('meetings and sessions', () => {
  it('only owners, sponsored guests and participants see a meeting and its session', async () => {
    const { rows } = await db.query<{ meeting: string; session: string }>(`
      with m as (
        insert into public.meetings (owner_id, room_name) values ('${alice}', 'room-rls') returning id
      ), s as (
        insert into public.call_sessions (meeting_id, host_id, initiated_by, status)
        select id, '${alice}', '${alice}', 'live' from m returning id, meeting_id
      ), p as (
        insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
        select id, '${bob}', 'guest', '${alice}', 'en-US', 'bn-BD' from s
      )
      select meeting_id as meeting, id as session from s
    `)
    const { meeting, session } = rows[0]!

    const visible = async (user: string) =>
      asUser(db, user, async (tx) => ({
        meetings: (await tx.query('select 1 from public.meetings where id = $1', [meeting])).rows
          .length,
        sessions: (await tx.query('select 1 from public.call_sessions where id = $1', [session]))
          .rows.length,
      }))

    expect(await visible(alice)).toEqual({ meetings: 1, sessions: 1 })
    expect(await visible(bob)).toEqual({ meetings: 1, sessions: 1 })
    expect(await visible(carol)).toEqual({ meetings: 0, sessions: 0 })
  })

  it('invitation token hashes are never readable', async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query('select token_hash from public.invitations')),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('privilege audit', () => {
  it('no client role can write any table except the editable profile columns', async () => {
    const { rows } = await db.query<{
      grantee: string
      table_name: string
      privilege_type: string
    }>(`
      select grantee, table_schema || '.' || table_name as table_name, privilege_type
      from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated')
        and table_schema in ('public', 'private')
        and privilege_type <> 'SELECT'
    `)
    expect(rows).toEqual([])

    const { rows: columnGrants } = await db.query<{ grantee: string; table_name: string }>(`
      select distinct grantee, table_name
      from information_schema.column_privileges
      where grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'
    `)
    expect(columnGrants).toEqual([{ grantee: 'authenticated', table_name: 'profiles' }])
  })

  it('anon has no table privileges at all', async () => {
    const { rows } = await db.query(`
      select 1 from information_schema.role_table_grants
      where grantee = 'anon' and table_schema in ('public', 'private')
    `)
    expect(rows).toEqual([])
  })

  it('every public table has RLS enabled', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity
    `)
    expect(rows).toEqual([])
  })
})
