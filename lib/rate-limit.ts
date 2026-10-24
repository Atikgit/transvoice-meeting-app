import 'server-only'
import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { serverEnv } from '@/lib/env'

/** Limits from docs/PROMPT.md §9. */
const LIMITS = {
  signup: { tokens: 5, window: '1 h' },
  login: { tokens: 20, window: '15 m' },
  // Password reset and confirmation emails: checked per IP and per email.
  passwordReset: { tokens: 5, window: '1 h' },
  resendConfirmation: { tokens: 5, window: '1 h' },
  invitation: { tokens: 20, window: '1 h' },
  meeting: { tokens: 30, window: '1 h' },
  call: { tokens: 10, window: '1 m' },
} satisfies Record<string, { tokens: number; window: Duration }>

export type RateLimitName = keyof typeof LIMITS

const WINDOW_MS: Record<string, number> = { m: 60_000, h: 3_600_000 }

interface Limiter {
  limit(key: string): Promise<{ success: boolean }>
}

/**
 * Sliding-window limiter kept in process memory. Used when Upstash is not configured; correct for
 * a single server (the Hetzner container), not shared across Vercel instances.
 */
export class MemoryRateLimiter implements Limiter {
  private hits = new Map<string, number[]>()

  constructor(
    private tokens: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  async limit(key: string) {
    const now = this.now()
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    const success = recent.length < this.tokens
    if (success) recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) this.prune(now)
    return { success }
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key)
    }
  }
}

function windowMs(window: Duration): number {
  const [amount, unit] = window.split(' ')
  return Number(amount) * (WINDOW_MS[unit ?? ''] ?? 1000)
}

const limiters = new Map<RateLimitName, Limiter>()
let warned = false

function limiter(name: RateLimitName): Limiter {
  let instance = limiters.get(name)
  if (instance) return instance

  const env = serverEnv()
  const { tokens, window } = LIMITS[name]
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    instance = new Ratelimit({
      redis: new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `tv:rl:${name}`,
    })
  } else {
    if (env.NODE_ENV === 'production' && !warned) {
      warned = true
      console.warn('UPSTASH_REDIS_REST_URL/TOKEN are not set: rate limits are per process.')
    }
    instance = new MemoryRateLimiter(tokens, windowMs(window))
  }
  limiters.set(name, instance)
  return instance
}

/** True if the call is allowed. */
export async function checkRateLimit(name: RateLimitName, key: string): Promise<boolean> {
  const { success } = await limiter(name).limit(key)
  return success
}

/** True only if every key is within the limit (e.g. per IP and per email). */
export async function checkRateLimits(name: RateLimitName, keys: string[]): Promise<boolean> {
  const results = await Promise.all(keys.map((key) => checkRateLimit(name, key)))
  return results.every(Boolean)
}
