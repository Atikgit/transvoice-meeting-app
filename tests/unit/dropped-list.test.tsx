// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DroppedList } from '@/components/meeting/dropped-list'

const SESSION = '22222222-2222-4222-8222-222222222222'
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const answer = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body ? JSON.stringify(body) : null, { status })),
  )

describe('DroppedList (overlay)', () => {
  it('renders nothing while the feature is off (404) or the user is not allowed', async () => {
    answer(404)
    const off = render(<DroppedList sessionId={SESSION} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(off.container).toBeEmptyDOMElement()
    cleanup()

    answer(200, { allowed: false, items: [] })
    const denied = render(<DroppedList sessionId={SESSION} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(denied.container).toBeEmptyDOMElement()
  })

  it('lists each dropped utterance with duration, peak / rms, class, and Play + Download', async () => {
    answer(200, {
      allowed: true,
      items: [
        {
          utteranceId: ID,
          createdAt: Date.UTC(2026, 10, 2, 18, 3, 5),
          expiresAt: Date.UTC(2026, 10, 2, 19, 3, 5),
          seconds: 1.5,
          peak: 0.5, // -6.0 dBFS
          rms: 0.1, // -20.0 dBFS
          sttClass: 'filtered_phantom',
          lang: 'bn-BD',
        },
      ],
    })
    render(<DroppedList sessionId={SESSION} />)
    const list = await screen.findByTestId('dropped-list')
    expect(fetch).toHaveBeenCalledWith(`/api/debug/dropped?sessionId=${SESSION}`, {
      cache: 'no-store',
    })
    expect(list).toHaveTextContent('dropped utterances (1, kept 1 h)')
    expect(list).toHaveTextContent('18:03:05')
    expect(list).toHaveTextContent('1.50 s')
    expect(list).toHaveTextContent('peak -6.0 / rms -20.0 dBFS')
    expect(list).toHaveTextContent('filtered_phantom')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      `/api/debug/dropped/${ID}?download=1`,
    )

    const play = vi.fn(async () => {})
    const urls: string[] = []
    vi.stubGlobal(
      'Audio',
      class {
        onended: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor(url: string) {
          urls.push(url)
        }
        play = play
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(urls).toEqual([`/api/debug/dropped/${ID}`])
    expect(play).toHaveBeenCalledOnce()
  })

  it('says "none yet" for an allowed user with nothing dropped', async () => {
    answer(200, { allowed: true, items: [] })
    render(<DroppedList sessionId={SESSION} />)
    expect(await screen.findByText('none yet')).toBeInTheDocument()
  })
})
