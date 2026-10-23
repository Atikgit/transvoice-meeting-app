import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import { balances, createTestDb, createUser, LEGACY_V0_SCHEMA } from './harness'

const V0_USER = `
  insert into auth.users (id, email, email_confirmed_at)
  values ('00000000-0000-4000-8000-000000000001', 'tester@example.com', now());
`
const V0_USER_ID = '00000000-0000-4000-8000-000000000001'

async function authUserTriggers(db: PGlite) {
  const { rows } = await db.query<{ trigger: string; fn: string }>(`
    select t.tgname as trigger, p.oid::regprocedure::text as fn
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
    order by 1
  `)
  return rows
}

async function trialCredits(db: PGlite, user: string) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int n from public.usage_ledger where payer_id = $1 and reason = 'free_trial'`,
    [user],
  )
  return rows[0]!.n
}

describe('migrating a database that still runs the v0 schema', () => {
  it('removes every legacy signup trigger, keeping only Phase 1 ones', async () => {
    const db = await createTestDb({ before: LEGACY_V0_SCHEMA + V0_USER })
    expect(await authUserTriggers(db)).toEqual([
      { trigger: 'on_auth_user_created', fn: 'private.handle_new_user()' },
      { trigger: 'on_auth_user_email_confirmed', fn: 'private.handle_user_email_confirmed()' },
    ])
    const { rows } = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ilike '%minutes_balance%'`,
    )
    expect(rows).toEqual([])
  })

  it(`gives existing and new verified users exactly ${FREE_TRIAL_MINUTES} minutes`, async () => {
    const db = await createTestDb({ before: LEGACY_V0_SCHEMA + V0_USER })
    expect((await balances(db, V0_USER_ID)).trial).toBe(FREE_TRIAL_MINUTES)

    const fresh = await createUser(db, 'new-after-push@example.com')
    expect(await balances(db, fresh)).toMatchObject({ trial: FREE_TRIAL_MINUTES, prepaid: 0 })
    expect(await trialCredits(db, fresh)).toBe(1)
  })
})

describe('20261022000700 on a database where 0000 already ran', () => {
  const cleanup = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261022000700_legacy_trigger_cleanup.sql'),
    'utf8',
  )

  it('drops a surviving legacy trigger and is safe to re-run', async () => {
    const db = await createTestDb()
    await db.exec(`
      create function public.legacy_minutes() returns trigger language plpgsql as $$
      begin
        update public.profiles set full_name = full_name where id = new.id;
        return new;
      end $$;
      create trigger legacy_signup after insert on auth.users
        for each row execute function public.legacy_minutes();
    `)
    await db.exec(cleanup)
    await db.exec(cleanup)
    expect((await authUserTriggers(db)).map((t) => t.trigger)).toEqual([
      'on_auth_user_created',
      'on_auth_user_email_confirmed',
    ])
  })

  it('routes signup and confirmation through ensure_user_account (one trial)', async () => {
    const db = await createTestDb()
    const user = await createUser(db, 'pending@example.com', { confirmed: false })
    expect((await balances(db, user)).trial).toBe(0)
    await db.query('update auth.users set email_confirmed_at = now() where id = $1', [user])
    expect((await balances(db, user)).trial).toBe(FREE_TRIAL_MINUTES)
    expect(await trialCredits(db, user)).toBe(1)

    const { rows } = await db.query<{ src: string }>(
      `select prosrc src from pg_proc where oid = 'private.handle_new_user'::regproc`,
    )
    expect(rows[0]!.src).toContain('ensure_user_account')
  })
})
