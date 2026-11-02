import { describe, expect, it } from 'vitest'
import { longTasksBetween, translateTiming } from '@/features/translation/net-timing'
import { buildReport } from '../../scripts/latency-report'

const entry = (
  name: string,
  startTime: number,
  requestStart: number,
  responseStart: number,
  responseEnd: number,
) => ({
  name,
  startTime,
  requestStart,
  responseStart,
  responseEnd,
})

describe('translateTiming (PerformanceResourceTiming of the POST)', () => {
  const entries = [
    entry('https://meet.test/api/translate/status?sessionId=x', 1000, 1005, 1100, 1110),
    entry('https://meet.test/api/translate', 2000, 2600, 3100, 3150),
    entry('https://meet.test/api/translate', 9000, 9020, 9400, 9420),
  ]
  it('splits a request into stalled / wait / download and picks the newest /api/translate one', () => {
    expect(translateTiming(entries, 8900)).toEqual({ stalledMs: 20, waitMs: 380, downloadMs: 20 })
    expect(translateTiming(entries, 1990)).toEqual({ stalledMs: 20, waitMs: 380, downloadMs: 20 }) // newest after `since`
    expect(translateTiming(entries.slice(0, 2), 1990)).toEqual({
      stalledMs: 600,
      waitMs: 500,
      downloadMs: 50,
    })
  })
  it('ignores other endpoints, older requests, and entries whose detail the browser hid', () => {
    expect(translateTiming(entries.slice(0, 1), 0)).toBeNull() // only /status
    expect(translateTiming(entries, 9500)).toBeNull() // nothing started since
    expect(translateTiming([entry('https://x/api/translate', 10, 0, 0, 50)], 0)).toBeNull()
  })
  it('can look at the chunk endpoint instead', () => {
    const chunk = [entry('https://meet.test/api/translate/chunk', 10, 15, 40, 45)]
    expect(translateTiming(chunk, 0)).toBeNull()
    expect(translateTiming(chunk, 0, '/api/translate/chunk')).toEqual({
      stalledMs: 5,
      waitMs: 25,
      downloadMs: 5,
    })
  })
})

describe('longTasksBetween', () => {
  const tasks = [
    { startTime: 100, duration: 80 },
    { startTime: 1000, duration: 300 },
    { startTime: 1500, duration: 60 },
    { startTime: 5000, duration: 90 },
  ]
  it('counts and sums the tasks that overlap the window', () => {
    expect(longTasksBetween(tasks, 900, 1550)).toEqual({ count: 2, totalMs: 360 })
    expect(longTasksBetween(tasks, 1290, 1500)).toEqual({ count: 2, totalMs: 360 }) // overlap at both edges
    expect(longTasksBetween(tasks, 2000, 3000)).toEqual({ count: 0, totalMs: 0 })
  })
})

describe('latency:report network-leg stages', () => {
  it('prints stalled / wait / download and long tasks, so network and browser CPU can be told apart', () => {
    const line = (id: string, stalledMs: number, longTasks: number) =>
      JSON.stringify({
        event: 'latency',
        utteranceId: id,
        kind: 'speak',
        roundTripMs: 8400,
        stalledMs,
        waitMs: 1900,
        downloadMs: 12,
        longTasks,
        longTaskMs: longTasks * 120,
      })
    const report = buildReport([line('a', 5800, 11), line('b', 6100, 14)])
    const stage = (name: string) => report.stages.find((s) => s.name === name)
    expect(stage('speaker: browser stalled before request (queue, DNS, TLS)')).toMatchObject({
      n: 2,
      p50: 5800,
    })
    expect(stage('speaker: request sent → first byte (upload + server + network)')).toMatchObject({
      p50: 1900,
    })
    expect(stage('speaker: long tasks during the request (count)')).toMatchObject({ n: 2, p95: 14 })
    expect(stage('speaker: long tasks during the request (ms)')).toMatchObject({ p95: 1680 })
  })
})
