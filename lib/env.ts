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

  // Public URL used in auth email links, e.g. https://meet.transvoice.ai.
  // Unset (Vercel previews, local dev): taken from the request.
  APP_URL: z.url().optional(),

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

  // Private beta for live translation until the Phase 3 minute meter: comma-separated emails of
  // meeting hosts. Unset → only the default allowlist (lib/translation/gate.ts); `*` → everyone.
  TRANSLATION_BETA_ALLOWLIST: z.string().optional(),

  // Translated audio clip cache (60 s). Unset: in-process memory (single container).
  // Only over a private Docker network, never a published port.
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://')
    .optional(),

  // Keep-alive ping to the TransVoice API while a session is live (seconds; 0 = off). The boot
  // ping always runs and logs whether the API is reachable from this container.
  TRANSVOICE_WARMUP_SEC: z.coerce.number().int().min(0).default(30),

  // How long the microphone must be silent before an utterance is sent (ms). Shorter = lower
  // latency but sentences may be cut at a breath; longer = safer for slow speakers.
  VAD_END_SILENCE_MS: z.coerce.number().int().min(300).max(700).default(400),

  // Rate limiting (Phase 2+)
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Billing config
  BILLING_MODE: z.enum(['wallclock']).default('wallclock'),
  LANG_MULTIPLIER_ENABLED: z.stringbool().default(true),
  RECONNECT_GRACE_SEC: z.coerce.number().int().positive().default(60),
  // Sweeper (lib/sweeper.ts): how often stale sessions, open segments and ringing calls are
  // cleaned up. 0 disables it.
  SWEEP_INTERVAL_SEC: z.coerce.number().int().min(0).default(60),
  // The free trial amount lives in the database (private.app_settings), not here.

  // Signup country (analytics). Without the salt no IP hash is stored; without the GeoLite2
  // database (downloaded at image build with MAXMIND_LICENSE_KEY) the country is null.
  IP_HASH_SALT: z.string().min(16).optional(),
  MAXMIND_LICENSE_KEY: z.string().min(1).optional(),
  GEOIP_DB_PATH: z.string().min(1).optional(),

  // Branded emails sent by the app (invites). Resend or SMTP; without either, invites to new
  // users fall back to Supabase's "Invite user" email.
  EMAIL_FROM: z.string().min(3).default('TransVoice AI <no-reply@transvoice.ai>'),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),

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
