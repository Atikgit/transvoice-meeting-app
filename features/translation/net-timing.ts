/**
 * Where the time between "the speaker stopped" and "the server answered" went, measured in the
 * browser: PerformanceResourceTiming of the /api/translate request (waiting in the browser's queue
 * or for a connection, request → first byte, download) and the long tasks (> 50 ms on the main
 * thread) that ran meanwhile. Together they tell a slow network from a busy browser.
 */
export interface NetTiming {
  /** Start of the fetch → request sent: browser queue, DNS, TCP, TLS (a busy main thread shows here too). */
  stalledMs: number
  /** Request sent → first byte back: upload + server + network. */
  waitMs: number
  /** First byte → last byte of the answer. */
  downloadMs: number
}

export interface LongTasks {
  count: number
  totalMs: number
}

interface TimingEntry {
  name: string
  startTime: number
  requestStart: number
  responseStart: number
  responseEnd: number
}

const round = (n: number) => Math.max(0, Math.round(n))

/** The newest /api/translate (or chunk) resource entry that started at or after `since`. */
export function translateTiming(
  entries: readonly TimingEntry[],
  since: number,
  path = '/api/translate',
): NetTiming | null {
  const entry = entries
    .filter((e) => e.startTime >= since - 5 && new URL(e.name, 'http://x').pathname === path)
    .at(-1)
  // 0 = the browser hid the detail (cross-origin without Timing-Allow-Origin) or the request failed.
  if (!entry || entry.requestStart === 0) return null
  return {
    stalledMs: round(entry.requestStart - entry.startTime),
    waitMs: round(entry.responseStart - entry.requestStart),
    downloadMs: round(entry.responseEnd - entry.responseStart),
  }
}

/** Long tasks that overlapped [from, to] (performance.now() times). */
export function longTasksBetween(
  tasks: readonly { startTime: number; duration: number }[],
  from: number,
  to: number,
): LongTasks {
  const inside = tasks.filter((t) => t.startTime + t.duration >= from && t.startTime <= to)
  return { count: inside.length, totalMs: round(inside.reduce((n, t) => n + t.duration, 0)) }
}

const tasks: { startTime: number; duration: number }[] = []
let observing = false

/** Starts recording long tasks (once per page; a browser without them just records none). */
export function observeLongTasks(): void {
  if (observing || typeof PerformanceObserver === 'undefined') return
  observing = true
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        tasks.push({ startTime: e.startTime, duration: e.duration })
      if (tasks.length > 200) tasks.splice(0, tasks.length - 200)
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // unsupported: no long-task numbers
  }
}

export function recordedLongTasks(): readonly { startTime: number; duration: number }[] {
  return tasks
}

/** What to add to the speak beacon for a request that started at `since` and ended just now. */
export function measureLeg(since: number, path = '/api/translate') {
  const net = translateTiming(
    typeof performance === 'undefined'
      ? []
      : (performance.getEntriesByType('resource') as unknown as TimingEntry[]),
    since,
    path,
  )
  const long = longTasksBetween(recordedLongTasks(), since, performance.now())
  return { ...net, longTasks: long.count, longTaskMs: long.totalMs }
}
