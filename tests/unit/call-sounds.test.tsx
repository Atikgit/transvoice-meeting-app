// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- the two sounds + alerts as spies, so the components can be checked for start/stop ----
const stopRingtone = vi.fn()
const startRingtone = vi.fn(() => stopRingtone)
const stopRingback = vi.fn()
const startRingback = vi.fn(() => stopRingback)
vi.mock('@/features/calls/call-sounds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calls/call-sounds')>()),
  startRingtone,
  startRingback,
}))
const stopAlerts = vi.fn()
const startCallAlerts = vi.fn((_name: string) => stopAlerts)
vi.mock('@/features/calls/call-alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calls/call-alerts')>()),
  startCallAlerts,
}))
let handlers: Record<string, (payload: never) => void> = {}
vi.mock('@/features/calls/useUserChannel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calls/useUserChannel')>()),
  useUserChannel: (_userId: string, h: Record<string, (payload: never) => void>) => {
    handlers = h
  },
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const { IncomingCallListener } = await import('@/components/calls/incoming-call')
const { ConnectionsCard } = await import('@/components/calls/connections-card')
const sounds = await import('@/features/calls/call-sounds')
const alerts = await vi.importActual<typeof import('@/features/calls/call-alerts')>(
  '@/features/calls/call-alerts',
)

const MEETING = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'
const inFuture = (s: number) => new Date(Date.now() + s * 1000).toISOString()
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  handlers = {}
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  sounds.setCallSoundsMuted(false)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------------------------
describe('tone loop (Web Audio, no files)', () => {
  /** A fake AudioContext that records every oscillator and when it was stopped. */
  function fakeContext(state: AudioContextState = 'running') {
    const oscillators: { freq: number; stopped: boolean; stopAt?: number }[] = []
    const ctx = {
      state,
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: () => {
        const entry = { freq: 0, stopped: false } as (typeof oscillators)[number]
        oscillators.push(entry)
        const osc = {
          type: 'sine',
          frequency: {
            set value(v: number) {
              entry.freq = v
            },
          },
          connect: (n: unknown) => n,
          start: vi.fn(),
          stop: vi.fn((at?: number) => {
            entry.stopped = true
            entry.stopAt = at
          }),
          onended: null,
        }
        return osc
      },
      createGain: () => ({
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: (n: unknown) => n,
      }),
    }
    return { ctx: ctx as unknown as AudioContext, oscillators, raw: ctx }
  }

  it('the ringtone is two tones (880 / 659.25 Hz) repeating every 3 s until stopped', () => {
    vi.useFakeTimers()
    const { ctx, oscillators } = fakeContext()
    const stop = sounds.startTonePattern(sounds.RINGTONE, () => ctx)
    expect(oscillators.map((o) => o.freq)).toEqual([880, 659.25, 880, 659.25])
    vi.advanceTimersByTime(3000)
    expect(oscillators).toHaveLength(8)
    stop()
    vi.advanceTimersByTime(9000)
    expect(oscillators).toHaveLength(8) // nothing scheduled after stop
    expect(oscillators.every((o) => o.stopped)).toBe(true) // and what was sounding is cut
  })

  it('the ringback is the 440 + 480 Hz double tone', () => {
    vi.useFakeTimers()
    const { ctx, oscillators } = fakeContext()
    sounds.startTonePattern(sounds.RINGBACK, () => ctx)()
    expect(oscillators.map((o) => o.freq)).toEqual([440, 480])
  })

  it('stays silent, and keeps trying, while the browser blocks audio', () => {
    vi.useFakeTimers()
    const { ctx, oscillators, raw } = fakeContext('suspended')
    const stop = sounds.startTonePattern(sounds.RINGTONE, () => ctx)
    expect(oscillators).toHaveLength(0)
    expect(raw.resume).toHaveBeenCalled()
    ;(raw as { state: string }).state = 'running' // the user tapped
    vi.advanceTimersByTime(3000)
    expect(oscillators.length).toBeGreaterThan(0)
    stop()
  })

  it('"Mute call sounds" silences it now and keeps it silent', () => {
    vi.useFakeTimers()
    const { ctx, oscillators } = fakeContext()
    const stop = sounds.startTonePattern(sounds.RINGTONE, () => ctx)
    expect(oscillators).toHaveLength(4)
    sounds.setCallSoundsMuted(true)
    expect(oscillators.every((o) => o.stopped)).toBe(true)
    vi.advanceTimersByTime(6000)
    expect(oscillators).toHaveLength(4)
    expect(localStorage.getItem('tv.callSounds.muted')).toBe('1')
    sounds.setCallSoundsMuted(false) // unmuting during the call rings again
    expect(oscillators.length).toBeGreaterThan(4)
    stop()
  })

  it('does nothing without Web Audio', () => {
    expect(() => sounds.startTonePattern(sounds.RINGTONE, () => null)()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
describe('visual and haptic alerts', () => {
  const deps = (over: Partial<Parameters<typeof alerts.startCallAlerts>[1]> = {}) => {
    const notifications: { title: string; closed: boolean; onclick: (() => void) | null }[] = []
    class FakeNotification {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
      closed = false
      onclick: (() => void) | null = null
      constructor(public title: string) {
        notifications.push(this)
      }
      close() {
        this.closed = true
      }
    }
    const doc = { title: 'Dashboard', hidden: true, hasFocus: () => false } as unknown as Document
    const nav = { vibrate: vi.fn(() => true) } as unknown as Navigator
    return {
      notifications,
      doc,
      nav,
      focus: vi.fn(),
      Notification: FakeNotification as unknown as typeof Notification,
      base: {
        document: doc,
        navigator: nav,
        Notification: FakeNotification as unknown as typeof Notification,
        focus: vi.fn(),
        ...over,
      },
    }
  }

  it('flashes the title, vibrates repeatedly and notifies; stop() restores everything', () => {
    vi.useFakeTimers()
    const d = deps()
    const stop = alerts.startCallAlerts('Rahim', d.base)
    expect(d.doc.title).toBe('📞 Incoming call from Rahim')
    vi.advanceTimersByTime(1000)
    expect(d.doc.title).toBe('Dashboard')
    vi.advanceTimersByTime(1000)
    expect(d.doc.title).toBe('📞 Incoming call from Rahim')
    vi.advanceTimersByTime(2000)
    expect(d.nav.vibrate).toHaveBeenCalledTimes(3) // at start, +2 s, +4 s
    expect(d.notifications).toHaveLength(1)
    stop()
    expect(d.doc.title).toBe('Dashboard')
    expect(d.nav.vibrate).toHaveBeenLastCalledWith(0)
    expect(d.notifications[0]!.closed).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(d.doc.title).toBe('Dashboard') // no timer left running
    expect(d.nav.vibrate).toHaveBeenCalledTimes(4)
  })

  it('does not notify while the tab is in front, or without permission', () => {
    const front = deps()
    ;(front.doc as { hidden: boolean }).hidden = false
    ;(front.doc as { hasFocus: () => boolean }).hasFocus = () => true
    alerts.startCallAlerts('Rahim', front.base)()
    expect(front.notifications).toHaveLength(0)

    const denied = deps()
    ;(denied.Notification as unknown as { permission: string }).permission = 'default'
    alerts.startCallAlerts('Rahim', denied.base)()
    expect(denied.notifications).toHaveLength(0)
  })

  it('works on browsers without vibrate or Notification', () => {
    const d = deps({ Notification: undefined, navigator: {} as Navigator })
    expect(() => alerts.startCallAlerts('Rahim', d.base)()).not.toThrow()
  })

  it('asks for notification permission only when called (from a click), once', async () => {
    const d = deps()
    const api = d.Notification as unknown as {
      permission: string
      requestPermission: () => Promise<string>
    }
    api.permission = 'default'
    expect(await alerts.requestNotificationPermission(d.Notification)).toBe('granted')
    expect(api.requestPermission).toHaveBeenCalledTimes(1)
    api.permission = 'denied'
    expect(await alerts.requestNotificationPermission(d.Notification)).toBe('denied')
    expect(api.requestPermission).toHaveBeenCalledTimes(1)
    expect(await alerts.requestNotificationPermission(undefined)).toBe('unsupported')
  })
})

// ---------------------------------------------------------------------------------------------
describe('incoming call: ringtone starts when the modal opens and stops on every outcome', () => {
  const ring = (seconds = 30, over = {}) =>
    act(() =>
      handlers.incoming_call!({
        sessionId: SESSION,
        meetingId: MEETING,
        callerName: 'Rahim',
        expiresAt: inFuture(seconds),
        ...over,
      } as never),
    )
  const open = async (seconds = 30) => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/calls/incoming'
        ? new Response(JSON.stringify({ calls: [] }))
        : new Response(JSON.stringify({ redirect: `/m/${MEETING}/lobby` })),
    )
    render(<IncomingCallListener userId="host-1" />)
    await waitFor(() => expect(handlers.incoming_call).toBeDefined())
    ring(seconds)
    await screen.findByText('Rahim is calling')
  }

  it('rings and alerts while it is open, and nothing before', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ calls: [] })))
    render(<IncomingCallListener userId="host-1" />)
    await waitFor(() => expect(handlers.incoming_call).toBeDefined())
    expect(startRingtone).not.toHaveBeenCalled()
    ring()
    await screen.findByText('Rahim is calling')
    expect(startRingtone).toHaveBeenCalledTimes(1)
    expect(startCallAlerts).toHaveBeenCalledWith('Rahim')
    expect(stopRingtone).not.toHaveBeenCalled()
  })

  it('stops on Accept', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(stopRingtone).toHaveBeenCalledTimes(1)
    expect(stopAlerts).toHaveBeenCalledTimes(1)
  })

  it('stops on Decline', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }))
    await waitFor(() => expect(stopRingtone).toHaveBeenCalledTimes(1))
    expect(stopAlerts).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Rahim is calling')).toBeNull()
  })

  it('stops when the caller hangs up', async () => {
    await open()
    act(() => handlers.call_cancelled!({ sessionId: SESSION } as never))
    expect(stopRingtone).toHaveBeenCalledTimes(1)
    expect(stopAlerts).toHaveBeenCalledTimes(1)
  })

  it('stops when the call is missed (30 s over)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ calls: [] })))
    render(<IncomingCallListener userId="host-1" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    ring(2)
    expect(screen.getByText('Rahim is calling')).toBeInTheDocument()
    expect(startRingtone).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })
    expect(screen.queryByText('Rahim is calling')).toBeNull()
    expect(stopRingtone).toHaveBeenCalledTimes(1)
    expect(stopAlerts).toHaveBeenCalledTimes(1)
  })

  it('stops when the page goes away', async () => {
    await open()
    cleanup()
    expect(stopRingtone).toHaveBeenCalledTimes(1)
    expect(stopAlerts).toHaveBeenCalledTimes(1)
  })

  it('"Mute ringtone" in the modal mutes the call sounds setting', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Mute ringtone/ }))
    expect(sounds.callSoundsMuted()).toBe(true)
    expect(screen.getByRole('button', { name: /Unmute ringtone/ })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
describe('caller: ringback while ringing, stops on every outcome', () => {
  const item = {
    meetingId: MEETING,
    name: 'Sponsor',
    role: 'guest' as const,
    expiresAt: inFuture(3600),
  }
  const start = async (seconds = 30) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'ringing',
          sessionId: SESSION,
          meetingId: MEETING,
          expiresAt: inFuture(seconds),
        }),
      ),
    )
    render(<ConnectionsCard userId="guest-1" connections={[item]} canSpend onSubscribe={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Call/ }))
    await screen.findByText('Calling Sponsor')
  }

  it('plays only while "Calling…" is shown', async () => {
    render(<ConnectionsCard userId="guest-1" connections={[item]} canSpend onSubscribe={vi.fn()} />)
    expect(startRingback).not.toHaveBeenCalled()
    cleanup()
    await start()
    expect(startRingback).toHaveBeenCalledTimes(1)
    expect(stopRingback).not.toHaveBeenCalled()
  })

  it('stops when the other person accepts', async () => {
    await start()
    act(() =>
      handlers.call_answered!({
        sessionId: SESSION,
        meetingId: MEETING,
        outcome: 'accepted',
      } as never),
    )
    expect(stopRingback).toHaveBeenCalledTimes(1)
  })

  it('stops when the other person declines', async () => {
    await start()
    act(() =>
      handlers.call_answered!({
        sessionId: SESSION,
        meetingId: MEETING,
        outcome: 'declined',
      } as never),
    )
    expect(stopRingback).toHaveBeenCalledTimes(1)
  })

  it('stops when the caller cancels', async () => {
    await start()
    fireEvent.click(screen.getByRole('button', { name: /close|cancel|hang/i }))
    await waitFor(() => expect(stopRingback).toHaveBeenCalledTimes(1))
  })

  it('stops when nobody answers within the time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'ringing',
          sessionId: SESSION,
          meetingId: MEETING,
          expiresAt: inFuture(1),
        }),
      ),
    )
    render(<ConnectionsCard userId="guest-1" connections={[item]} canSpend onSubscribe={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Call/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(startRingback).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800)
    })
    expect(stopRingback).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------------------------
describe('"Enable call sounds" banner and Settings', () => {
  it('shows once when audio is blocked, enables on click, and is never shown again once closed', async () => {
    const { EnableCallSoundsBanner } = await import('@/components/calls/enable-call-sounds')
    const view = render(<EnableCallSoundsBanner />)
    expect(await screen.findByRole('region', { name: 'Call sounds' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region', { name: 'Call sounds' })).toBeNull()
    view.unmount()
    render(<EnableCallSoundsBanner />)
    expect(screen.queryByRole('region', { name: 'Call sounds' })).toBeNull()
    expect(localStorage.getItem('tv.callSounds.bannerDismissed')).toBe('1')
  })

  it('is hidden when call sounds are muted', async () => {
    const { EnableCallSoundsBanner } = await import('@/components/calls/enable-call-sounds')
    sounds.setCallSoundsMuted(true)
    render(<EnableCallSoundsBanner />)
    expect(screen.queryByRole('region', { name: 'Call sounds' })).toBeNull()
  })

  it('Settings has a Mute call sounds toggle that is remembered', async () => {
    const { CallSoundsSetting } = await import('@/components/calls/enable-call-sounds')
    render(<CallSoundsSetting />)
    const toggle = screen.getByRole('checkbox', { name: /Mute call sounds/ })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(sounds.callSoundsMuted()).toBe(true)
    expect(localStorage.getItem('tv.callSounds.muted')).toBe('1')
    expect(screen.getByRole('button', { name: 'Play ringtone' })).toBeDisabled()
  })
})
