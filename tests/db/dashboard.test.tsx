import type { PGlite } from '@electric-sql/pglite'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import {
  as,
  confirmEmail,
  createOAuthUserWithoutTriggers,
  createTestDb,
  createUser,
} from './harness'

/**
 * Renders the real /dashboard layout + page against PGlite. The Supabase client fake runs each
 * `.from(t).select(cols).eq(col, v).maybeSingle()` as the signed-in user (RLS enforced), and
 * admin RPCs with full privileges, so the test covers trigger → RLS select → rendered balance.
 */
let db: PGlite
let signedIn: { id: string; email: string } | null = null

function fromAsUser(table: string) {
  return {
    select: (columns: string) => ({
      eq: (column: string, value: string) => ({
        maybeSingle: async () => {
          const rows = await as(db, 'authenticated', signedIn?.id ?? null, async (tx) => {
            const result = await tx.query(
              `select ${columns} from public.${table} where ${column} = $1`,
              [value],
            )
            return result.rows
          })
          return { data: rows[0] ?? null, error: null }
        },
      }),
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn } }) },
    from: fromAsUser,
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    // Committed (as() rolls back); the grants to service_role are covered in billing.test.ts.
    rpc: async (fn: string, args: { p_user: string }) => {
      const { rows } = await db.query<{ result: unknown }>(`select public.${fn}($1) result`, [
        args.p_user,
      ])
      return { data: rows[0]!.result, error: null }
    },
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

async function renderDashboard() {
  const { default: DashboardLayout } = await import('@/app/dashboard/layout')
  const { default: DashboardPage } = await import('@/app/dashboard/page')
  const html = renderToStaticMarkup(await DashboardLayout({ children: await DashboardPage() }))
  return {
    text: html.replace(/<[^>]+>/g, ''),
    /** The "Translation minutes" card value. */
    card: /(\d+)<span[^>]*> mins<\/span>/.exec(html)?.[1],
  }
}

beforeEach(async () => {
  db = await createTestDb()
  signedIn = null
}, 30_000)

describe('/dashboard balance', () => {
  it(`a freshly verified user sees ${FREE_TRIAL_MINUTES} min`, async () => {
    const id = await createUser(db, 'fresh@example.com', { confirmed: false })
    await confirmEmail(db, id)
    signedIn = { id, email: 'fresh@example.com' }

    const page = await renderDashboard()
    expect(page.text).toContain(`${FREE_TRIAL_MINUTES} min remaining`)
    expect(page.card).toBe(String(FREE_TRIAL_MINUTES))
  })

  it('an unverified user sees 0 min', async () => {
    const id = await createUser(db, 'later@example.com', { confirmed: false })
    signedIn = { id, email: 'later@example.com' }

    const page = await renderDashboard()
    expect(page.text).toContain('0 min remaining')
  })

  it('creates a missing account on first visit and grants the OAuth trial', async () => {
    const id = await createOAuthUserWithoutTriggers(db, 'new@example.com', 'google')
    signedIn = { id, email: 'new@example.com' }

    const page = await renderDashboard()
    expect(page.text).toContain(`${FREE_TRIAL_MINUTES} min remaining`)
    expect(page.card).toBe(String(FREE_TRIAL_MINUTES))
  })
})
