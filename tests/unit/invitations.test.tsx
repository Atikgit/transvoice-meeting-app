// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'meet.transvoice.ai' }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))

const { acceptInvitation, createInvitation } = await import('@/app/invite/actions')
const { InviteModal } = await import('@/components/invite/invite-modal')
const { shareLinks } = await import('@/lib/invitations/windows')

const MEETING = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://meet.transvoice.ai'
  getSessionUser.mockResolvedValue({ id: 'host-1', email: 'host@example.com' })
  rpc.mockResolvedValue({
    data: [
      {
        meeting_id: MEETING,
        invitation_id: 'i1',
        expires_at: '2026-10-30T10:00:00Z',
        reused: true,
      },
    ],
    error: null,
  })
})
afterEach(cleanup)

describe('createInvitation', () => {
  it('sends only the token hash to the database and returns the raw token once', async () => {
    const result = await createInvitation({ window: '24h' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const token = result.url.replace('https://meet.transvoice.ai/invite/', '')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rpc).toHaveBeenCalledWith('create_invitation', {
      p_user: 'host-1',
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_window: '24 hours',
      p_meeting: undefined,
    })
    expect(result.meetingId).toBe(MEETING)
  })

  it('maps "no minutes" and "unverified" to clear errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_MINUTES' } })
    expect(await createInvitation({ window: '7d' })).toMatchObject({
      ok: false,
      code: 'NO_MINUTES',
    })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'EMAIL_NOT_VERIFIED' } })
    expect(await createInvitation({ window: '7d' })).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
    })
  })

  it('rejects unknown windows and signed-out users', async () => {
    // @ts-expect-error invalid on purpose
    expect(await createInvitation({ window: '2d' })).toMatchObject({ ok: false })
    getSessionUser.mockResolvedValueOnce(null)
    expect(await createInvitation({ window: '7d' })).toMatchObject({ code: 'SIGNED_OUT' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('acceptInvitation', () => {
  const token = 'a'.repeat(43)
  const form = () => {
    const data = new FormData()
    data.set('token', token)
    return data
  }

  it('opens the meeting lobby', async () => {
    rpc.mockResolvedValueOnce({ data: MEETING, error: null })
    await expect(acceptInvitation(form())).rejects.toThrow(`NEXT_REDIRECT /m/${MEETING}/lobby`)
  })

  it('sends signed-out users to login and back', async () => {
    getSessionUser.mockResolvedValueOnce(null)
    await expect(acceptInvitation(form())).rejects.toThrow(
      `NEXT_REDIRECT /login?next=${encodeURIComponent(`/invite/${token}`)}`,
    )
  })

  it('explains expired links', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVITE_EXPIRED' } })
    await expect(acceptInvitation(form())).rejects.toThrow(`/invite/${token}?error=expired`)
  })
})

describe('InviteModal', () => {
  it('defaults to 7 days, then shows the link with share buttons', async () => {
    render(<InviteModal onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: '1 hour' }))
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))

    const link = await screen.findByRole('textbox', { name: 'Invite link' })
    expect((link as HTMLInputElement).value).toMatch(/^https:\/\/meet\.transvoice\.ai\/invite\//)
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_window: '1 hour' })
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\//,
    )
    expect(screen.getByRole('link', { name: /LinkedIn/ }).getAttribute('href')).toMatch(
      /linkedin\.com\/sharing/,
    )
    expect(screen.getByRole('link', { name: /Email/ }).getAttribute('href')).toMatch(/^mailto:/)
  })

  it('says which meeting the link opens, and links the host to it from the dashboard', async () => {
    render(<InviteModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    expect(await screen.findByText(/opens the meeting you are already in/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to this meeting' })).toHaveAttribute(
      'href',
      `/m/${MEETING}/lobby`,
    )
  })

  it('says so when the link opens a NEW meeting; inside a room there is no extra link', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          meeting_id: MEETING,
          invitation_id: 'i1',
          expires_at: '2026-10-30T10:00:00Z',
          reused: false,
        },
      ],
      error: null,
    })
    const { unmount } = render(<InviteModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    expect(await screen.findByText(/opens a new meeting/)).toBeInTheDocument()
    unmount()

    render(<InviteModal meetingId={MEETING} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    await screen.findByText(/opens a new meeting|already in/)
    expect(screen.queryByRole('link', { name: 'Go to this meeting' })).toBeNull()
  })

  it('offers to get minutes when the balance is empty', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_MINUTES' } })
    const onNoMinutes = vi.fn()
    render(<InviteModal onClose={() => {}} onNoMinutes={onNoMinutes} />)
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no minutes/))
    fireEvent.click(screen.getByRole('button', { name: 'Get minutes' }))
    expect(onNoMinutes).toHaveBeenCalled()
  })
})

describe('shareLinks', () => {
  it('encodes the invite URL for each target', () => {
    const links = shareLinks('https://meet.transvoice.ai/invite/abc')
    expect(decodeURIComponent(links.whatsapp)).toContain('https://meet.transvoice.ai/invite/abc')
    expect(links.linkedin).toBe(
      'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fmeet.transvoice.ai%2Finvite%2Fabc',
    )
    expect(decodeURIComponent(links.email)).toContain('TransVoice AI')
  })
})
