import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMessageStream, STREAM_RETRY_MS } from '@/features/translation/message-stream'

class FakeSource {
  static all: FakeSource[] = []
  readyState = 1
  onerror: (() => void) | null = null
  closed = false
  listeners = new Map<string, (e: MessageEvent<string>) => void>()
  constructor(public url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, fn)
  }
  close() {
    this.closed = true
  }
  emit(data: string) {
    this.listeners.get('m')?.({ data } as MessageEvent<string>)
  }
}
const create = (url: string) => new FakeSource(url) as unknown as EventSource
const link = (connected: boolean) => {
  let cb = () => {}
  return {
    state: { connected },
    room: {
      isConnected: () => link_state.connected,
      onConnected: (c: () => void) => ((cb = c), () => {}),
    },
    fire: () => cb(),
  }
}
const link_state = { connected: true }

afterEach(() => {
  FakeSource.all = []
  vi.useRealTimers()
})

describe('openMessageStream (DELIVERY=sse client)', () => {
  it('opens /api/stream once the room is connected and turns events into topic + bytes', () => {
    link_state.connected = false
    const l = link(false)
    const got: [string, number[]][] = []
    const stop = openMessageStream('s-1', l.room, (t, b) => got.push([t, [...b]]), create)
    expect(FakeSource.all).toHaveLength(0) // not connected yet
    link_state.connected = true
    l.fire()
    expect(FakeSource.all[0]!.url).toBe('/api/stream?sessionId=s-1')
    FakeSource.all[0]!.emit(JSON.stringify({ t: 'tvx.caption', b: btoa('\x01\x02\x03') }))
    expect(got).toEqual([['tvx.caption', [1, 2, 3]]])
    FakeSource.all[0]!.emit('not json') // ignored
    expect(got).toHaveLength(1)
    stop()
    expect(FakeSource.all[0]!.closed).toBe(true)
  })

  it('a refusal (closed source) is retried after a pause; stop cancels the retry', () => {
    vi.useFakeTimers()
    link_state.connected = true
    const stop = openMessageStream('s-1', link(true).room, () => {}, create)
    const first = FakeSource.all[0]!
    first.readyState = 2
    first.onerror?.()
    expect(FakeSource.all).toHaveLength(1)
    vi.advanceTimersByTime(STREAM_RETRY_MS)
    expect(FakeSource.all).toHaveLength(2)
    FakeSource.all[1]!.readyState = 2
    FakeSource.all[1]!.onerror?.()
    stop()
    vi.advanceTimersByTime(STREAM_RETRY_MS * 2)
    expect(FakeSource.all).toHaveLength(2)
  })

  it('a network drop that the browser retries itself is left alone', () => {
    link_state.connected = true
    openMessageStream('s-1', link(true).room, () => {}, create)
    FakeSource.all[0]!.readyState = 0 // CONNECTING: the browser is reconnecting
    FakeSource.all[0]!.onerror?.()
    expect(FakeSource.all).toHaveLength(1)
  })
})
