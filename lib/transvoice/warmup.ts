import 'server-only'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { transvoiceFetch } from '@/lib/transvoice/http'

export interface WarmupResult {
  /** The API's Keep-Alive response header, e.g. "timeout=5": how long it keeps idle connections. */
  keepAlive?: string | null
  /** Any HTTP answer counts: it proves DNS, routing and TLS from this container work. */
  reachable: boolean
  status: number | null
  ms: number
}

/**
 * Opens (or reuses) a connection to the TransVoice API and logs whether it answered. At boot this
 * is also the quickest production check of "can the container reach TRANSVOICE_API_URL?"
 * (keepAlive shows how long the API keeps idle connections: if it is shorter than
 * TRANSVOICE_WARMUP_SEC, lower that setting):
 *   docker logs transvoice_meeting_app 2>&1 | grep transvoice_warmup
 * Never throws; sends no credentials and no audio.
 */
export async function warmUpTransvoice(
  fetcher: typeof transvoiceFetch = transvoiceFetch,
): Promise<WarmupResult> {
  const started = performance.now()
  let result: WarmupResult
  let detail: string | undefined
  try {
    const res = await fetcher(serverEnv().TRANSVOICE_API_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    await res.arrayBuffer().catch(() => {}) // drain, so the connection goes back to the pool
    result = {
      reachable: true,
      status: res.status,
      keepAlive: res.headers.get('keep-alive'),
      ms: Math.round(performance.now() - started),
    }
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 120) : 'unknown'
    result = { reachable: false, status: null, ms: Math.round(performance.now() - started) }
  }
  console.info(JSON.stringify({ event: 'transvoice_warmup', ...result, detail }))
  return result
}

async function liveSessions(): Promise<number> {
  const { count } = await createAdminClient()
    .from('call_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'live')
  return count ?? 0
}

let timer: ReturnType<typeof setInterval> | undefined

/** Warms up now, then every `everyMs` while at least one session is live (0: only now). */
export function startWarmup(
  everyMs: number,
  deps: { warm: () => Promise<unknown>; live: () => Promise<number> } = {
    warm: warmUpTransvoice,
    live: liveSessions,
  },
) {
  if (timer) return
  void deps.warm()
  if (everyMs <= 0) return
  timer = setInterval(() => {
    void deps
      .live()
      .then((n) => (n > 0 ? deps.warm() : undefined))
      .catch(() => {})
  }, everyMs)
  timer.unref()
}

export function stopWarmup() {
  clearInterval(timer)
  timer = undefined
}
