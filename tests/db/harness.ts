import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/**
 * Minimal stand-in for the parts of Supabase the migrations depend on: the API roles, the
 * auth.users table and auth.uid(). Lets RLS run in-process (PGlite) without Docker.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'
  );

  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null,
    identity_data jsonb not null default '{}'
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase grants API roles broad default privileges; the migrations must revoke them.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  return db
}

export async function createUser(
  db: PGlite,
  email: string,
  { confirmed = true, fullName }: { confirmed?: boolean; fullName?: string } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, case when $2 then now() end, jsonb_build_object('full_name', $3::text))
     returning id`,
    [email, confirmed, fullName ?? null],
  )
  return rows[0]!.id
}

/**
 * A Google/LinkedIn user as Supabase Auth may store it: provider-verified identity, but
 * email_confirmed_at not set and the auth.users triggers skipped (session_replication_role).
 */
export async function createOAuthUserWithoutTriggers(
  db: PGlite,
  email: string,
  provider: 'google' | 'linkedin_oidc',
): Promise<string> {
  let id = ''
  await db.transaction(async (tx) => {
    await tx.exec(`set local session_replication_role = replica`)
    const { rows } = await tx.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [email],
    )
    id = rows[0]!.id
    await tx.query(
      `insert into auth.identities (user_id, provider, identity_data)
       values ($1, $2, jsonb_build_object('email', $3::text, 'email_verified', true))`,
      [id, provider, email],
    )
  })
  return id
}

export async function confirmEmail(db: PGlite, userId: string): Promise<void> {
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [userId])
}

type Role = 'anon' | 'authenticated' | 'service_role'

/** Runs `fn` as an API role (with auth.uid() = userId) inside a rolled-back transaction. */
export async function as<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined
  await db
    .transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
      await tx.exec(`set local role ${role}`)
      result = await fn(tx)
      throw new Rollback()
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error
    })
  return result as T
}

class Rollback extends Error {}

export const asUser = <T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>) =>
  as(db, 'authenticated', userId, fn)

/** Billing account balances as numbers. */
export async function balances(db: PGlite, userId: string) {
  const { rows } = await db.query<{
    trial: string
    prepaid: string
    accrued: string
    billing_type: string
    plan: string
  }>(
    `select trial_minutes_remaining trial, prepaid_minutes_remaining prepaid,
            postpaid_minutes_accrued accrued, billing_type, plan
     from public.billing_accounts where user_id = $1`,
    [userId],
  )
  const row = rows[0]
  if (!row) throw new Error(`No billing account for ${userId}`)
  return {
    trial: Number(row.trial),
    prepaid: Number(row.prepaid),
    accrued: Number(row.accrued),
    billingType: row.billing_type,
    plan: row.plan,
  }
}
