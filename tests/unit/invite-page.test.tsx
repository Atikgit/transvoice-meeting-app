// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'a'.repeat(43)
const getSessionUser = vi.fn()
let invitation: Record<string, unknown> | null
let accepted: { id: string } | null
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({
              data:
                table === 'invitations'
                  ? invitation
                  : table === 'profiles'
                    ? { full_name: 'Mohammad' }
                    : accepted,
            }),
          }
          return chain
        },
      }),
    }),
  }),
}))
vi.mock('@/app/invite/actions', () => ({ acceptInvitation: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { default: InvitePage } = await import('@/app/invite/[token]/page')

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const past = () => new Date(Date.now() - 1000).toISOString()
const open = async (error?: string) =>
  render(
    await InvitePage({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve(error ? { error } : {}),
    }),
  )

beforeEach(() => {
  getSessionUser.mockResolvedValue({ id: 'guest-1', email: 'guest@example.com' })
  invitation = {
    id: 'inv-1',
    inviter_id: 'host-1',
    expires_at: future(),
    revoked_at: null,
    used_count: 1,
    max_uses: 20,
  }
  accepted = null
})
afterEach(cleanup)

describe('/invite/[token]', () => {
  it('a new person is invited to accept', async () => {
    await open()
    expect(screen.getByText(/Mohammad invited you to a translated meeting/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept and join the meeting' })).toBeInTheDocument()
  })

  it('the same person opening it again is welcomed back and goes straight to the meeting', async () => {
    accepted = { id: 'sc-1' }
    await open()
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open the meeting' })).toBeInTheDocument()
  })

  it('full: new people are told so; people already in can still open it', async () => {
    invitation = { ...invitation, used_count: 20, max_uses: 20 }
    await open()
    expect(screen.getByText(/This invitation link is full/)).toBeInTheDocument()
    cleanup()
    accepted = { id: 'sc-1' }
    await open()
    expect(screen.getByRole('button', { name: 'Open the meeting' })).toBeInTheDocument()
  })

  it('expired and revoked links say so, also for people who joined before', async () => {
    accepted = { id: 'sc-1' }
    invitation = { ...invitation, expires_at: past() }
    await open()
    expect(screen.getByText(/This invitation has expired/)).toBeInTheDocument()
    cleanup()
    invitation = { ...invitation, expires_at: future(), revoked_at: past() }
    await open()
    expect(screen.getByText(/This invitation was cancelled/)).toBeInTheDocument()
  })

  it('the host opening their own link always gets in, even when it is expired', async () => {
    getSessionUser.mockResolvedValue({ id: 'host-1', email: 'host@example.com' })
    invitation = { ...invitation, expires_at: past() }
    await open()
    expect(screen.getByRole('button', { name: 'Open the meeting' })).toBeInTheDocument()
  })

  it('an unknown link is "not valid"', async () => {
    invitation = null
    await open()
    expect(screen.getByText(/This invitation link is not valid/)).toBeInTheDocument()
  })
})
