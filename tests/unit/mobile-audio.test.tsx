// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getLocalDevices = vi.fn()
const switchActiveDevice = vi.fn(async () => {})
vi.mock('livekit-client', () => ({ Room: { getLocalDevices }, RoomEvent: {} }))

const { useWakeLock } = await import('@/features/meeting/useWakeLock')
const { routeToLoudspeaker } = await import('@/features/meeting/audio-output')

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('screen wake lock', () => {
  const sentinels: { released: boolean; release: ReturnType<typeof vi.fn> }[] = []
  const request = vi.fn()
  beforeEach(() => {
    sentinels.length = 0
    request.mockReset().mockImplementation(async () => {
      const s = {
        released: false,
        release: vi.fn(async function (this: { released: boolean }) {
          s.released = true
        }),
        addEventListener: vi.fn(),
      }
      sentinels.push(s)
      return s
    })
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    setVisibility('visible')
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock')
  })

  it('is held while live, re-acquired when the tab comes back, released afterwards', async () => {
    const { rerender, unmount } = renderHook(({ live }) => useWakeLock(live), {
      initialProps: { live: false },
    })
    expect(request).not.toHaveBeenCalled()

    rerender({ live: true })
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')

    // The browser drops the lock when the tab is hidden.
    sentinels[0]!.released = true
    setVisibility('hidden')
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(2)

    unmount()
    expect(sentinels[1]!.release).toHaveBeenCalled()
  })

  it('does nothing where the Wake Lock API does not exist', () => {
    Reflect.deleteProperty(navigator, 'wakeLock')
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow()
  })
})

describe('routeToLoudspeaker', () => {
  const room = { switchActiveDevice } as never
  const setUa = (ua: string) =>
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36'
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: async () => {},
      configurable: true,
    })
  })
  afterEach(() => Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId'))

  it('switches an Android phone to the speaker output', async () => {
    setUa(ANDROID)
    getLocalDevices.mockResolvedValue([
      { deviceId: 'ear', label: 'Earpiece' },
      { deviceId: 'spk', label: 'Speakerphone' },
    ])
    expect(await routeToLoudspeaker(room)).toBe(true)
    expect(switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'spk')
  })

  it('leaves desktops alone', async () => {
    setUa('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36')
    expect(await routeToLoudspeaker(room)).toBe(false)
    expect(getLocalDevices).not.toHaveBeenCalled()
  })

  it('does nothing where output selection is unsupported (iOS Safari) or no speaker is listed', async () => {
    setUa(ANDROID)
    getLocalDevices.mockResolvedValue([{ deviceId: 'bt', label: 'Bluetooth headset' }])
    expect(await routeToLoudspeaker(room)).toBe(false)
    Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
    expect(await routeToLoudspeaker(room)).toBe(false)
    expect(switchActiveDevice).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    setUa(ANDROID)
    getLocalDevices.mockRejectedValue(new Error('denied'))
    expect(await routeToLoudspeaker(room)).toBe(false)
  })
})
