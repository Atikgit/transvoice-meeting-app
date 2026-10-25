import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { http, passthrough } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { server as msw } from '../mocks/server'
import { KEEP_ALIVE_MS, closeTransvoicePool, transvoiceDispatcher } from '@/lib/transvoice/http'
import { startWarmup, stopWarmup, warmUpTransvoice } from '@/lib/transvoice/warmup'

let server: Server
let url: string
let connections = 0
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(405, { 'content-length': 2, 'keep-alive': 'timeout=5' }).end('{}')
  })
  server.keepAliveTimeout = 60_000
  server.on('connection', () => connections++)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})
// A real local HTTP server: let msw's global "fail on unhandled" setup step aside for it.
beforeEach(() => msw.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough())))
afterAll(async () => {
  stopWarmup()
  await closeTransvoicePool()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

describe('keep-alive pool to the TransVoice API', () => {
  it('keeps idle connections for a minute (Node drops them after 4 s)', () => {
    expect(KEEP_ALIVE_MS).toBe(60_000)
    expect(transvoiceDispatcher()).toBe(transvoiceDispatcher()) // one pool per process
  })

  it('reuses one TCP connection for requests with pauses in between', async () => {
    // undici's own fetch: msw replaces the global one in unit tests and would open its own sockets.
    const { fetch: realFetch } = await import('undici')
    connections = 0
    for (let i = 0; i < 4; i++) {
      const res = await realFetch(url, { dispatcher: transvoiceDispatcher() })
      await res.arrayBuffer()
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    expect(connections).toBe(1)
  })
})

describe('transvoiceFetch', () => {
  it('sends every request through the keep-alive pool', async () => {
    const { transvoiceFetch } = await import('@/lib/transvoice/http')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))
    await transvoiceFetch('https://transvoice.test/', { method: 'POST' })
    expect(spy.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      dispatcher: transvoiceDispatcher(),
    })
    spy.mockRestore()
  })
})

describe('warm-up ping', () => {
  it('logs reachable + status for any HTTP answer, and a reason when it cannot connect', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { transvoiceFetch } = await import('@/lib/transvoice/http')
    const ok = await warmUpTransvoice((_input, init) => transvoiceFetch(url, init))
    expect(ok).toMatchObject({ reachable: true, status: 405, keepAlive: 'timeout=5' })
    const down = await warmUpTransvoice(async () => {
      throw new Error('getaddrinfo ENOTFOUND transvoice.test')
    })
    expect(down).toMatchObject({ reachable: false, status: null })
    const lines = info.mock.calls.map((c) => JSON.parse(String(c[0])))
    expect(lines[0]).toMatchObject({ event: 'transvoice_warmup', reachable: true, status: 405 })
    expect(lines[1]).toMatchObject({
      reachable: false,
      detail: expect.stringContaining('ENOTFOUND'),
    })
    info.mockRestore()
  })

  it('pings at start and then only while a session is live', async () => {
    vi.useFakeTimers()
    const warm = vi.fn(async () => {})
    const live = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2).mockResolvedValue(1)
    startWarmup(30_000, { warm, live })
    expect(warm).toHaveBeenCalledTimes(1) // boot
    await vi.advanceTimersByTimeAsync(30_000) // no live session
    expect(warm).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000) // live
    expect(warm).toHaveBeenCalledTimes(2)
    stopWarmup()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(warm).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
