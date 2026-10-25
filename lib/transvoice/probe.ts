import 'server-only'
import { serverEnv } from '@/lib/env'
import { transvoiceFetch } from '@/lib/transvoice/http'

/**
 * Does the TransVoice API accept our key? One authenticated POST that carries no audio and no text
 * (nothing to transcribe, translate or bill): the API checks the key before it looks at the body,
 * so 401/403 mean "key rejected" and any other answer means the key was accepted. Cached for a
 * minute. Used only by the status endpoint / debug overlay.
 */
export type ApiAuth = 'ok' | 'rejected' | 'unreachable'

let cached: { at: number; value: ApiAuth } | undefined

export async function probeApiAuth(now = Date.now()): Promise<ApiAuth> {
  if (cached && now - cached.at < 60_000) return cached.value
  let value: ApiAuth
  try {
    const env = serverEnv()
    const res = await transvoiceFetch(env.TRANSVOICE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.TRANSVOICE_MASTER_API_KEY}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    })
    await res.arrayBuffer().catch(() => {})
    value = res.status === 401 || res.status === 403 ? 'rejected' : 'ok'
  } catch {
    value = 'unreachable'
  }
  cached = { at: now, value }
  return value
}

export function resetApiProbeForTests() {
  cached = undefined
}
