// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeTranslation,
  TranslationStatusLine,
} from '@/components/meeting/translation-status-line'
import {
  STATUS_POLL_MS,
  useTranslationStatus,
  type TranslationStatus,
} from '@/features/translation/useTranslationStatus'

const status = (over: Partial<TranslationStatus> = {}): TranslationStatus => ({
  sessionStatus: 'live',
  me: { spokenLang: 'bn-BD', listenLang: 'bn-BD' },
  others: [
    { name: 'Atikul', role: 'guest', spokenLang: 'en-US', listenLang: 'en-US', connected: true },
  ],
  fanout: { reason: 'ok', targets: [{ lang: 'en-US', listeners: 1 }] },
  incoming: [{ name: 'Atikul', from: 'en-US', to: 'bn-BD', translated: true }],
  swapped: false,
  decision: { allowed: true, reason: 'ok' },
  allowlist: 'everyone',
  translationEnabled: true,
  api: 'ok',
  ...over,
})

afterEach(cleanup)

describe('describeTranslation', () => {
  it('says what is translated in both directions, in plain words', () => {
    expect(describeTranslation(status())).toEqual({
      text: 'You speak Bangla → Atikul hears English · You hear Atikul in Bangla',
      tone: 'ok',
    })
  })

  it('same language: says so', () => {
    const line = describeTranslation(
      status({
        me: { spokenLang: 'en-US', listenLang: 'en-US' },
        fanout: { reason: 'same_language', targets: [] },
        incoming: [{ name: 'Atikul', from: 'en-US', to: 'en-US', translated: false }],
      }),
    )
    expect(line.text).toBe('Same language (English): nothing to translate.')
  })

  it('the swapped setup is named, with the one-tap fix to hear your own language', () => {
    const line = describeTranslation(
      status({
        me: { spokenLang: 'bn-BD', listenLang: 'en-US' },
        fanout: { reason: 'same_language', targets: [] },
        swapped: true,
      }),
    )
    expect(line.tone).toBe('warn')
    expect(line.text).toMatch(/you each hear the other's own language/)
    expect(line.fix).toEqual({ label: 'I want to hear Bangla', listenLang: 'bn-BD' })
  })

  it('explains why translation is off before anything else', () => {
    expect(
      describeTranslation(
        status({
          decision: {
            allowed: false,
            reason: 'BETA',
            message: 'Live translation is in private beta.',
          },
        }),
      ).text,
    ).toBe('Live translation is in private beta.')
    expect(describeTranslation(status({ api: 'rejected' })).text).toMatch(/rejected our access key/)
    expect(
      describeTranslation(status({ fanout: { reason: 'no_listeners', targets: [] } })).text,
    ).toBe('Waiting for your partner to connect.')
    expect(describeTranslation(null).text).toBe('Checking translation…')
  })

  it('renders the fix button and reports the chosen language', () => {
    const onFix = vi.fn()
    render(
      <TranslationStatusLine
        status={status({
          me: { spokenLang: 'bn-BD', listenLang: 'en-US' },
          fanout: { reason: 'same_language', targets: [] },
          swapped: true,
        })}
        onFix={onFix}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'I want to hear Bangla' }))
    expect(onFix).toHaveBeenCalledWith('bn-BD')
  })
})

describe('useTranslationStatus', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the partner’s change within one poll (3 s), and refresh() fetches at once', async () => {
    let current = status()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(current)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationStatus('s1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status?.others[0]!.listenLang).toBe('en-US')

    // The partner changes "I want to hear" on their side.
    current = status({
      others: [
        {
          name: 'Atikul',
          role: 'guest',
          spokenLang: 'en-US',
          listenLang: 'es-ES',
          connected: true,
        },
      ],
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_POLL_MS)
    })
    expect(result.current.status?.others[0]!.listenLang).toBe('es-ES')
    expect(STATUS_POLL_MS).toBeLessThanOrEqual(3000)

    current = status({ me: { spokenLang: 'fr-FR', listenLang: 'fr-FR' } })
    await act(async () => result.current.refresh())
    expect(result.current.status?.me.spokenLang).toBe('fr-FR')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/translate/status?sessionId=s1',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('keeps the last known values when a poll fails, and stops polling on unmount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(status())))
      .mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => useTranslationStatus('s1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_POLL_MS)
    })
    expect(result.current.failed).toBe(true)
    expect(result.current.status?.me.spokenLang).toBe('bn-BD')
    unmount()
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})
