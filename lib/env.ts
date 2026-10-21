import 'server-only'
import { z } from 'zod'

/**
 * Server-only environment. Validated once on server start (see instrumentation.ts)
 * and lazily on first access, so a missing secret fails fast instead of at request time.
 *
 * Variables needed only by later phases are optional for now and become required
 * in the phase that introduces them.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // LiveKit
  NEXT_PUBLIC_LIVEKIT_URL: z.url(),
  LIVEKIT_URL: z.url().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  // TransVoice Speech API (Triton on Azure VM)
  TRANSVOICE_API_URL: z.url(),
  TRANSVOICE_MASTER_API_KEY: z.string().min(1),

  // Lemon Squeezy
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().min(1),
  LEMONSQUEEZY_API_KEY: z.string().min(1).optional(),
  LEMONSQUEEZY_STORE_ID: z.string().min(1).optional(),

  // Internal endpoints (Phase 4+)
  USAGE_INGEST_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),

  // Rate limiting (Phase 2+)
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Billing config
  BILLING_MODE: z.enum(['wallclock']).default('wallclock'),
  LANG_MULTIPLIER_ENABLED: z.stringbool().default(true),
  RECONNECT_GRACE_SEC: z.coerce.number().int().positive().default(60),
  // The free trial amount lives in the database (private.app_settings), not here.

  // Auth providers (server-side so they can change without rebuilding the image)
  AUTH_GOOGLE_ENABLED: z.stringbool().default(false),
  AUTH_LINKEDIN_ENABLED: z.stringbool().default(false),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | undefined

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Treat `KEY=` (empty) as unset so optional variables copied from .env.example validate.
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''))
  const result = serverSchema.safeParse(defined)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid server environment variables:\n${issues}`)
  }
  return result.data
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env)
  return cached
}
