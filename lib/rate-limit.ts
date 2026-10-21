import 'server-only'
import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { serverEnv } from '@/lib/env'

/** Limits from docs/PROMPT.md §9. */
const LIMITS = {
  signup: { tokens: 5, window: '1 h' },
  login: { tokens: 20, window: '15 m' },
} satisfies Record<string, { tokens: number; window: Duration }>

export type RateLimitName = keyof typeof LIMITS

const limiters = new Map<RateLimitName, Ratelimit>()
let warned = false

function limiter(name: RateLimitName): Ratelimit | null {
  const env = serverEnv()
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    if (env.NODE_ENV === 'production' && !warned) {
      warned = true
      console.warn('Rate limiting is disabled: UPSTASH_REDIS_REST_URL/TOKEN are not set.')
    }
    return null
  }
  let instance = limiters.get(name)
  if (!instance) {
    const { tokens, window } = LIMITS[name]
    instance = new Ratelimit({
      redis: new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `tv:rl:${name}`,
    })
    limiters.set(name, instance)
  }
  return instance
}

/** True if the call is allowed. Allows everything when Upstash is not configured. */
export async function checkRateLimit(name: RateLimitName, key: string): Promise<boolean> {
  const instance = limiter(name)
  if (!instance) return true
  const { success } = await instance.limit(key)
  return success
}
