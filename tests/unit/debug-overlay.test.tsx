// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationStatus } from '@/features/translation/useTranslationStatus'

vi.mock('@livekit/components-react', () => ({
  useConnectionState: () => 'connected',
  useLocalParticipant: () => ({
    localParticipant: { getTrackPublication: () => undefined },
  }),
}))
vi.mock('livekit-client', () => ({ Track: { Source: { Microphone: 'microphone' } } }))
const uploadUtterance = vi.fn()
vi.mock('@/features/translation/useLiveTranslation', () => ({ uploadUtterance }))

const { DebugOverlay } = await import('@/components/meeting/debug-overlay')
const { setTranslationDebug, enableTranslationDebug, rememberUtterance } =
  await import('@/features/translation/debug-store')

const SESSION = '22222222-2222-4222-8222-222222222222'
const status = (over: Partial<TranslationStatus> = {}): TranslationStatus => ({
  sessionStatus: 'live',
  me: { spokenLang: 'bn-BD', listenLang: 'bn-BD' },
  others: [
    { name: 'Atikul', role: 'guest', spokenLang: 'en-US', listenLang: 'en-US', connected: true },
  ],
  fanout: { reason: 'ok', targets: [{ lang: 'en-US', listeners: 1 }] },
  incoming: [],
  swapped: false,
  decision: { allowed: true, reason: 'ok' },
  allowlist: 'everyone',
  translationEnabled: true,
  api: 'ok',
  ...over,
})
const overlay = (s: TranslationStatus | null = null) =>
  render(<DebugOverlay sessionId={SESSION} spokenLang="bn-BD" listenLang="en-US" status={s} />)

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  )
})
afterEach(() => {
  cleanup()
  enableTranslationDebug(false)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('translation debug overlay', () => {
  it('shows the gate, VAD, last request and languages, and explains a closed gate', async () => {
    overlay(status({ fanout: { reason: 'same_language', targets: [] } }))
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
      }),
    )
    const panel = screen.getByTestId('debug-overlay')
    expect(panel).toHaveTextContent('closed (session live, 2 connected, mic MUTED)')
    expect(panel).toHaveTextContent('loaded, paused')
    expect(panel).toHaveTextContent('2.4 s, 75 KiB')
    expect(panel).toHaveTextContent('200 in 1830 ms')
    expect(panel).toHaveTextContent('url ok in 120 ms')
    await waitFor(() => expect(panel).toHaveTextContent('4/4 ok'))
  })

  it('prints what the server stores for both people, where my sentences go and the allowlist decision', () => {
    overlay(status())
    const panel = screen.getByTestId('debug-overlay')
    expect(panel).toHaveTextContent('translation allowed')
    expect(panel).toHaveTextContent('yes (open to everyone)')
    expect(panel).toHaveTextContent('me (server)speak bn-BD, hear bn-BD')
    expect(panel).toHaveTextContent('Atikul: speak en-US, hear en-US')
    expect(panel).toHaveTextContent('my sentences go toen-US ×1')
    expect(panel).toHaveTextContent('API key accepted')
  })

  it('names the reason when translation is not allowed, the key is rejected or nobody needs it', () => {
    overlay(
      status({
        decision: { allowed: false, reason: 'BETA' },
        api: 'rejected',
        fanout: { reason: 'same_language', targets: [] },
      }),
    )
    const panel = screen.getByTestId('debug-overlay')
    expect(panel).toHaveTextContent('NO: BETA')
    expect(panel).toHaveTextContent('REJECTED (401)')
    expect(panel).toHaveTextContent('nobody (same language)')
  })

  it('reports files the page cannot load and anything the CSP refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) => new Response(null, { status: url.endsWith('.wasm') ? 404 : 200 }),
      ),
    )
    overlay()
    await waitFor(() =>
      expect(screen.getByTestId('debug-overlay')).toHaveTextContent(
        'ort-wasm-simd-threaded.wasm 404',
      ),
    )
    act(() => {
      const event = new Event('securitypolicyviolation') as Event & {
        effectiveDirective: string
        blockedURI: string
      }
      event.effectiveDirective = 'worker-src'
      event.blockedURI = 'blob:https://meet.transvoice.ai/x'
      document.dispatchEvent(event)
    })
    expect(screen.getByTestId('debug-overlay')).toHaveTextContent('worker-src ✗ blob:')
  })

  it('"Send test clip" sends the last sentence through /api/translate and prints the exact answer', async () => {
    uploadUtterance.mockResolvedValue(
      new Response(JSON.stringify({ reason: 'same_language', languages: [] }), { status: 200 }),
    )
    overlay(status())
    // No speech yet: a tone is sent. Then the VAD cuts a sentence and that is what gets sent.
    fireEvent.click(screen.getByRole('button', { name: 'Send test clip' }))
    await waitFor(() =>
      expect(screen.getByTestId('debug-test-result')).toHaveTextContent('a tone → 200'),
    )
    expect(uploadUtterance.mock.calls[0]![0]).toMatchObject({ sessionId: SESSION })

    const sentence = new Float32Array(16_000).fill(0.1)
    act(() => rememberUtterance(sentence))
    uploadUtterance.mockResolvedValue(new Response('{"error":"Not allowed"}', { status: 403 }))
    fireEvent.click(screen.getByRole('button', { name: 'Send test clip' }))
    await waitFor(() =>
      expect(screen.getByTestId('debug-test-result')).toHaveTextContent('your last sentence → 403'),
    )
    expect(screen.getByTestId('debug-test-result')).toHaveTextContent('{"error":"Not allowed"}')
    expect(uploadUtterance.mock.calls[1]![0].utterance.samples).toBe(sentence)
  })

  it('records nothing while the overlay is not mounted', () => {
    setTranslationDebug({ queue: 9 })
    overlay()
    expect(screen.getByTestId('debug-overlay')).toHaveTextContent('playback queue0')
  })
})
