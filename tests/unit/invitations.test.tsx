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

const { acceptInvitation, createInvitation, revokeInvitation } =
  await import('@/app/invite/actions')
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
      },
    ],
    error: null,
  })
})
afterEach(cleanup)

describe('createInvitation', () => {
  it('sends only the token hash to the database and returns the raw token once', async () => {
    const result = await createInvitation({ window: '24h', meetingId: MEETING })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const token = result.url.replace('https://meet.transvoice.ai/invite/', '')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rpc).toHaveBeenCalledWith('create_invitation', {
      p_user: 'host-1',
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_window: '24 hours',
      p_meeting: MEETING,
      p_max_uses: 20,
    })
    expect(result.meetingId).toBe(MEETING)
  })

  it('maps "no minutes" and "unverified" to clear errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_MINUTES' } })
    expect(await createInvitation({ window: '7d', meetingId: MEETING })).toMatchObject({
      ok: false,
      code: 'NO_MINUTES',
    })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'EMAIL_NOT_VERIFIED' } })
    expect(await createInvitation({ window: '7d', meetingId: MEETING })).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
    })
  })

  it('rejects unknown windows and signed-out users', async () => {
    // @ts-expect-error invalid on purpose
    expect(await createInvitation({ window: '2d', meetingId: MEETING })).toMatchObject({
      ok: false,
    })
    getSessionUser.mockResolvedValueOnce(null)
    expect(await createInvitation({ window: '7d', meetingId: MEETING })).toMatchObject({
      code: 'SIGNED_OUT',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('link places and revoking', () => {
  it('passes the chosen number of places (default 20, 1 to 100)', async () => {
    await createInvitation({ window: '7d', meetingId: MEETING, maxUses: 100 })
    await createInvitation({ window: '7d', meetingId: MEETING, maxUses: 1 })
    expect(rpc.mock.calls.map(([, args]) => args.p_max_uses)).toEqual([100, 1])
    expect(await createInvitation({ window: '7d', meetingId: MEETING, maxUses: 0 })).toMatchObject({
      ok: false,
    })
    expect(
      await createInvitation({ window: '7d', meetingId: MEETING, maxUses: 101 }),
    ).toMatchObject({
      ok: false,
    })
    expect(rpc).toHaveBeenCalledTimes(2) // the invalid ones never reached the database
  })

  it('revokes a link by its URL, for the inviter only', async () => {
    const token = 'a'.repeat(43)
    rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(
      await revokeInvitation({ inviteUrl: `https://meet.transvoice.ai/invite/${token}` }),
    ).toEqual({
      ok: true,
    })
    expect(rpc).toHaveBeenLastCalledWith('revoke_invitation', {
      p_user: 'host-1',
      p_token_hash: createHash('sha256').update(token).digest('hex'),
    })
    rpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await revokeInvitation({ inviteUrl: `https://x/invite/${token}` })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already revoked, or is not yours/),
    })
    expect(await revokeInvitation({ inviteUrl: 'https://x/nope' })).toMatchObject({ ok: false })
    getSessionUser.mockResolvedValueOnce(null)
    expect(await revokeInvitation({ inviteUrl: `https://x/invite/${token}` })).toMatchObject({
      ok: false,
    })
  })
})

describe('an invitation never creates a meeting', () => {
  const missing: unknown[] = [undefined, '', 'not-a-uuid', 123, null]

  it.each(missing)('refuses meetingId = %j before doing anything', async (meetingId) => {
    // @ts-expect-error the type requires a meeting; the server must not trust it
    const result = await createInvitation({ window: '7d', meetingId })
    expect(result).toMatchObject({ ok: false, code: 'MEETING_REQUIRED' })
    expect(rpc).not.toHaveBeenCalled() // no invitation, no meeting
    expect(getSessionUser).not.toHaveBeenCalled()
  })

  it('refuses a call with no body fields at all', async () => {
    // @ts-expect-error invalid on purpose
    expect(await createInvitation({})).toMatchObject({ ok: false, code: 'MEETING_REQUIRED' })
    // @ts-expect-error invalid on purpose
    expect(await createInvitation(undefined)).toMatchObject({ code: 'MEETING_REQUIRED' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('every accepted call passes its meeting to the database, never null', async () => {
    await createInvitation({ window: '1h', meetingId: MEETING })
    expect(rpc.mock.calls.every(([, args]) => args.p_meeting === MEETING)).toBe(true)
  })

  it('a meeting the user is not part of is a clear error, not a new meeting', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_ALLOWED' } })
    expect(await createInvitation({ window: '7d', meetingId: MEETING })).toMatchObject({
      ok: false,
      code: 'NOT_ALLOWED',
    })
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
    render(<InviteModal meetingId={MEETING} onClose={() => {}} />)
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

  it('lets the host pick how many people can use the link (default 20) and revoke it afterwards', async () => {
    render(<InviteModal meetingId={MEETING} onClose={() => {}} />)
    const places = screen.getByRole('combobox', {
      name: /People who can use the link/,
    }) as HTMLSelectElement
    expect(places.value).toBe('20')
    fireEvent.change(places, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    expect(await screen.findByText(/Up to 5 people can use it/)).toBeInTheDocument()
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_max_uses: 5 })

    rpc.mockResolvedValueOnce({ data: true, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke this link' }))
    expect(
      await screen.findByText(/Link revoked: it no longer works for anyone/),
    ).toBeInTheDocument()
    expect(rpc).toHaveBeenLastCalledWith(
      'revoke_invitation',
      expect.objectContaining({ p_user: 'host-1' }),
    )
  })

  it('offers to get minutes when the balance is empty', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_MINUTES' } })
    const onNoMinutes = vi.fn()
    render(<InviteModal meetingId={MEETING} onClose={() => {}} onNoMinutes={onNoMinutes} />)
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
