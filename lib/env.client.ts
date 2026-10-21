import { z } from 'zod'

/**
 * Public (browser-safe) environment. Each NEXT_PUBLIC_* variable must be referenced
 * literally so Next.js can inline it into the client bundle.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_LIVEKIT_URL: z.url(),
})

export type ClientEnv = z.infer<typeof clientSchema>

let cached: ClientEnv | undefined

export function clientEnv(): ClientEnv {
  cached ??= clientSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_LIVEKIT_URL: process.env.NEXT_PUBLIC_LIVEKIT_URL,
  })
  return cached
}
