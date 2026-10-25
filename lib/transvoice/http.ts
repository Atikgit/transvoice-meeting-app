import 'server-only'
import { Agent } from 'undici'

/**
 * One keep-alive connection pool to the TransVoice API for the whole process. Node's default
 * pool drops idle connections after 4 s, so in a conversation (pauses of 5–10 s) most
 * utterances would pay a new TCP + TLS handshake to the Azure VM. Here an idle connection is
 * kept for 60 s, and the warm-up ping (lib/transvoice/warmup.ts) keeps one alive while a
 * session is live. On globalThis so every route bundle shares the pool.
 */
const holder = globalThis as unknown as { __tvDispatcher?: Agent }

export const KEEP_ALIVE_MS = 60_000

export function transvoiceDispatcher(): Agent {
  holder.__tvDispatcher ??= new Agent({
    keepAliveTimeout: KEEP_ALIVE_MS,
    keepAliveMaxTimeout: 5 * 60_000,
    connections: 32,
    connect: { timeout: 3000 },
  })
  return holder.__tvDispatcher
}

/** fetch() through the keep-alive pool (the global fetch, so tests can still intercept it). */
export function transvoiceFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, dispatcher: transvoiceDispatcher() } as RequestInit)
}

export async function closeTransvoicePool() {
  const agent = holder.__tvDispatcher
  holder.__tvDispatcher = undefined
  await agent?.close().catch(() => {})
}
