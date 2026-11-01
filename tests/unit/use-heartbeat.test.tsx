// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HEARTBEAT_MS, useHeartbeat } from '@/features/meeting/useHeartbeat'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useHeartbeat', () => {
  it('beats at once, then every 20 s while active (4 calls in 60 s), and stops when unmounted', () => {
    const { unmount } = renderHook(() => useHeartbeat('s-1', true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1 + Math.floor(60_000 / HEARTBEAT_MS))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/heartbeat')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ sessionId: 's-1' })
    unmount()
    vi.advanceTimersByTime(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('sends nothing while the room is not connected', () => {
    renderHook(() => useHeartbeat('s-1', false))
    vi.advanceTimersByTime(120_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('beats again when the network comes back', () => {
    renderHook(() => useHeartbeat('s-1', true))
    window.dispatchEvent(new Event('online'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
