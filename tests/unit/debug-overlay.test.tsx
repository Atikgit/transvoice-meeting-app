// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@livekit/components-react', () => ({ useConnectionState: () => 'connected' }))

const { DebugOverlay } = await import('@/components/meeting/debug-overlay')
const { setTranslationDebug, enableTranslationDebug } =
  await import('@/features/translation/debug-store')
const { isAllowlistedUser } = await import('@/lib/translation/gate')

afterEach(() => {
  cleanup()
  enableTranslationDebug(false)
})

describe('translation debug overlay', () => {
  it('shows the gate, VAD, last request and languages, and explains a closed gate', () => {
    render(<DebugOverlay spokenLang="bn-BD" listenLang="en-US" />)
    act(() =>
      setTranslationDebug({
        vad: 'ready',
        gate: {
          status: 'live',
          remotes: 1,
          micEnabled: false,
          playingTranslation: false,
          translationEnabled: true,
        },
        lastUtterance: { ms: 2400, bytes: 76_844, at: Date.now() },
        lastTranslate: { status: 200, ms: 1830, at: Date.now() },
        lastCaption: { lang: 'en-US', at: Date.now() },
        lastAudio: { via: 'url', status: 'ok', ms: 120, at: Date.now() },
        queue: 2,
        listenerLanguages: ['en-US', 'es-ES'],
      }),
    )
    const panel = screen.getByTestId('debug-overlay')
    expect(panel).toHaveTextContent('closed (session live, 2 connected, mic MUTED)')
    expect(panel).toHaveTextContent('loaded, paused')
    expect(panel).toHaveTextContent('2.4 s, 75 KiB')
    expect(panel).toHaveTextContent('200 in 1830 ms')
    expect(panel).toHaveTextContent('en-US')
    expect(panel).toHaveTextContent('url ok in 120 ms')
    expect(panel).toHaveTextContent('speak bn-BD, hear en-US')
    expect(panel).toHaveTextContent('en-US, es-ES')
  })

  it('opens the gate only when everything is right; says so when nobody needs translating', () => {
    render(<DebugOverlay spokenLang="en-US" listenLang="en-US" />)
    act(() =>
      setTranslationDebug({
        gate: {
          status: 'live',
          remotes: 1,
          micEnabled: true,
          playingTranslation: false,
          translationEnabled: true,
        },
        listenerLanguages: [],
      }),
    )
    const panel = screen.getByTestId('debug-overlay')
    expect(panel).toHaveTextContent('OPEN')
    expect(panel).toHaveTextContent('none (same language)')
  })

  it('records nothing while the overlay is not mounted', () => {
    setTranslationDebug({ queue: 9 })
    render(<DebugOverlay spokenLang="en-US" listenLang="en-US" />)
    expect(screen.getByTestId('debug-overlay')).toHaveTextContent('playback queue0')
  })
})

describe('who may see the overlay in production', () => {
  it('only a user named on the allowlist; "*" and strangers do not count', () => {
    expect(isAllowlistedUser('Me@Example.com', 'me@example.com,you@example.com')).toBe(true)
    expect(isAllowlistedUser('other@example.com', 'me@example.com')).toBe(false)
    expect(isAllowlistedUser('other@example.com', '*')).toBe(false)
    expect(isAllowlistedUser('codera1a1@gmail.com', undefined)).toBe(true) // built-in default
    expect(isAllowlistedUser(undefined, 'me@example.com')).toBe(false)
  })
})
