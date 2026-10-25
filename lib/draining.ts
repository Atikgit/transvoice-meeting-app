/**
 * Shutdown state shared by the instrumentation hook (which receives SIGTERM) and the route
 * handlers. Next.js can load them as separate module instances, so the flag lives on globalThis.
 */
const KEY = Symbol.for('transvoice.draining')
const state = globalThis as unknown as Record<symbol, boolean | undefined>

/** Longest an in-flight request may take to finish after SIGTERM before the process exits. */
export const DRAIN_MAX_MS = 10_000
/** Clients retry a 503 once after this delay (restart or rolling deploy in progress). */
export const DRAIN_RETRY_MS = 2_000

export function startDraining() {
  state[KEY] = true
}

export function isDraining(): boolean {
  return state[KEY] === true
}
