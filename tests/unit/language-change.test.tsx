// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getSessionUser = vi.fn()
const updateParticipant = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  RoomServiceClient: class {
    updateParticipant = updateParticipant
  },
}))

const { POST } = await import('@/app/api/calls/[id]/languages/route')
const { LanguageMenu } = await import('@/components/meeting/language-menu')

const SESSION = '22222222-2222-4222-8222-222222222222'
const call = (body: unknown, id = SESSION) =>
  POST(
    new NextRequest(`https://meet.transvoice.ai/api/calls/${id}/languages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: 'guest-1' })
  updateParticipant.mockResolvedValue({})
  rpc.mockResolvedValue({
    data: [{ display_name: 'Guest', role: 'guest', spoken_lang: 'en-US', listen_lang: 'es-ES' }],
    error: null,
  })
})
afterEach(cleanup)

describe('language spelling', () => {
  it('stores "bn_BD" and "bn" in the one spelling the picker uses', async () => {
    const res = await call({ spokenLang: 'bn', listenLang: 'bn_bd' })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      'set_participant_langs',
      expect.objectContaining({ p_spoken: 'bn-BD', p_listen: 'bn-BD' }),
    )
  })
})

describe('POST /api/calls/[id]/languages', () => {
  it('updates meeting_participants and the LiveKit participant metadata', async () => {
    const res = await call({ listenLang: 'es-ES' })
    expect(await res.json()).toEqual({
      spokenLang: 'en-US',
      listenLang: 'es-ES',
      metadataUpdated: true,
    })
    expect(rpc).toHaveBeenCalledWith('set_participant_langs', {
      p_session: SESSION,
      p_user: 'guest-1',
      p_spoken: undefined,
      p_listen: 'es-ES',
    })
    expect(updateParticipant).toHaveBeenCalledWith(
      `tv-${SESSION}`,
      'guest-1',
      JSON.stringify({ name: 'Guest', spokenLang: 'en-US', listenLang: 'es-ES', role: 'guest' }),
    )
  })

  it('still succeeds when the participant is not connected to LiveKit right now', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    updateParticipant.mockRejectedValue(new Error('participant not found'))
    const res = await call({ spokenLang: 'bn-BD' })
    expect(res.status).toBe(200)
    expect((await res.json()).metadataUpdated).toBe(false)
  })

  it.each([
    [{ spokenLang: 'zu-ZA' }], // listen-only language cannot be spoken
    [{ listenLang: 'xx-XX' }],
    [{}],
  ])('rejects %j without touching the database', async (body) => {
    expect((await call(body)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('401 signed out; 403 for non-participants; 409 for closed sessions', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    expect((await call({ listenLang: 'es-ES' })).status).toBe(401)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_A_PARTICIPANT' } })
    expect((await call({ listenLang: 'es-ES' })).status).toBe(403)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'SESSION_CLOSED' } })
    expect((await call({ listenLang: 'es-ES' })).status).toBe(409)
  })
})

describe('LanguageMenu', () => {
  it('lists spoken languages only under "I speak" and saves a change', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ spokenLang: 'bn-BD', listenLang: 'es-ES' })),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<LanguageMenu sessionId={SESSION} spokenLang="bn-BD" listenLang="en-US" />)
    fireEvent.click(screen.getByRole('button', { name: /Languages/ }))
    const speak = screen.getByRole('combobox', { name: 'I speak' }) as HTMLSelectElement
    const hear = screen.getByRole('combobox', { name: 'I want to hear' }) as HTMLSelectElement
    expect([...speak.options].some((o) => o.value === 'zu-ZA')).toBe(false)
    expect([...hear.options].some((o) => o.value === 'zu-ZA')).toBe(true)

    fireEvent.change(hear, { target: { value: 'es-ES' } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('applies from your next sentence'),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/calls/${SESSION}/languages`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ listenLang: 'es-ES' }) }),
    )
    expect(hear.value).toBe('es-ES')
    vi.unstubAllGlobals()
  })

  it('shows the server’s error inline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'This meeting has ended.' }), { status: 409 }),
      ),
    )
    render(<LanguageMenu sessionId={SESSION} spokenLang="bn-BD" listenLang="en-US" />)
    fireEvent.click(screen.getByRole('button', { name: /Languages/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'I want to hear' }), {
      target: { value: 'fr-FR' },
    })
    expect(await screen.findByText('This meeting has ended.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
