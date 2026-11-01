import 'server-only'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The app's side of the minute meter. pg_cron calls apply_minute_tick every minute; this is the
 * fallback timer (and what POST /api/internal/meter-tick runs). Running both is safe: the SQL
 * function takes an advisory lock and every ledger row is idempotent.
 */
export interface MeterSummary {
  skipped: boolean
  reason?: string
  buckets?: number
  rows?: number
  alreadyBilled?: number
  minutesDebited?: number
  minutesAccrued?: number
  shortfallMinutes?: number
  payersTouched?: number
  payersDepleted?: number
  basis?: string
}

export interface MeterDeps {
  /** Copies BILLING_BASIS and LANG_MULTIPLIER_ENABLED into the database (pg_cron reads them there). */
  configure: (basis: string, multiplier: boolean) => Promise<void>
  tick: () => Promise<Record<string, unknown>>
  basis: string
  multiplier: boolean
  now?: () => number
}

export function defaultMeterDeps(): MeterDeps {
  const env = serverEnv()
  const admin = createAdminClient()
  return {
    basis: env.BILLING_BASIS,
    multiplier: env.LANG_MULTIPLIER_ENABLED,
    configure: async (basis, multiplier) => {
      const { error } = await admin.rpc('configure_billing', {
        p_basis: basis,
        p_multiplier: multiplier,
      })
      if (error) throw new Error(error.message)
    },
    tick: async () => {
      const { data, error } = await admin.rpc('apply_minute_tick')
      if (error) throw new Error(error.message)
      return (data ?? {}) as Record<string, unknown>
    },
  }
}

let configured: string | undefined

const num = (value: unknown) => (typeof value === 'number' ? value : undefined)

/**
 * One tick. Logs a single JSON line with counts only (no user, session or payer ids). Throws if
 * the database call fails, after logging that too.
 */
export async function meterTickOnce(
  source: 'timer' | 'http',
  deps: MeterDeps = defaultMeterDeps(),
): Promise<MeterSummary> {
  const startedAt = (deps.now ?? Date.now)()
  try {
    const wanted = `${deps.basis}:${deps.multiplier}`
    if (configured !== wanted) {
      await deps.configure(deps.basis, deps.multiplier)
      configured = wanted
    }
    const raw = await deps.tick()
    const summary: MeterSummary = {
      skipped: raw.skipped === true,
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      buckets: num(raw.buckets),
      rows: num(raw.rows),
      alreadyBilled: num(raw.already_billed),
      minutesDebited: num(raw.minutes_debited),
      minutesAccrued: num(raw.minutes_accrued),
      shortfallMinutes: num(raw.shortfall_minutes),
      payersTouched: num(raw.payers_touched),
      payersDepleted: num(raw.payers_depleted),
      basis: typeof raw.basis === 'string' ? raw.basis : undefined,
    }
    // Quiet when nothing happened (every minute, all day), loud when something was billed or skipped.
    if (summary.skipped || (summary.rows ?? 0) > 0 || (summary.alreadyBilled ?? 0) > 0) {
      console.info(
        JSON.stringify({
          event: 'meter_tick',
          source,
          ...summary,
          ms: (deps.now ?? Date.now)() - startedAt,
        }),
      )
    }
    return summary
  } catch (error) {
    configured = undefined
    console.error(
      JSON.stringify({
        event: 'meter_tick_failed',
        source,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      }),
    )
    throw error
  }
}

let timer: ReturnType<typeof setInterval> | undefined
let running = false

/** Ticks now, then every METER_TICK_SEC. A slow run is never overlapped by the next one. */
export function startMeterTimer(deps?: MeterDeps, intervalMs = serverEnv().METER_TICK_SEC * 1000) {
  if (timer || intervalMs <= 0) return
  const run = () => {
    if (running) return
    running = true
    meterTickOnce('timer', deps)
      .catch(() => {})
      .finally(() => {
        running = false
      })
  }
  run()
  timer = setInterval(run, intervalMs)
  timer.unref()
}

export function stopMeterTimer() {
  clearInterval(timer)
  timer = undefined
}

export function meterTimerRunning(): boolean {
  return timer !== undefined
}

/** For tests. */
export function resetMeterState() {
  configured = undefined
  running = false
  stopMeterTimer()
}
