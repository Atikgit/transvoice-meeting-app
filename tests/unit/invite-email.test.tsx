// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.fn()
const inviteUserByEmail = vi.fn()
const invitationRow = vi.fn()
const send = vi.fn()
let mailerKind: 'resend' | 'smtp' | null = 'resend'
let ip = '203.0.113.10'

vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
let supabaseFallback = false
vi.mock('@/lib/email/mailer', () => ({
  appMailer: () => (mailerKind ? { kind: mailerKind, send } : null),
  appMailerStatus: () =>
    mailerKind
      ? { configured: true, kind: mailerKind }
      : {
          configured: false,
          kind: 'none',
          missing: ['RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS'],
        },
}))
vi.mock('@/lib/env', async (original) => ({
  ...(await original<typeof import('@/lib/env')>()),
  serverEnv: () => ({ INVITE_EMAIL_SUPABASE_FALLBACK: supabaseFallback }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail } },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'invitations' ? invitationRow() : { full_name: 'Atik <b>Islam</b>' },
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'meet.transvoice.ai', 'x-forwarded-for': ip }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { sendInvitationEmail } = await import('@/app/invite/actions')
const { buildInviteEmailHtml, buildInviteEmailText, escapeHtml, inviteEmailSubject } =
  await import('@/lib/email/invite-template')

const TOKEN = 'T'.repeat(43)
const URL = `https://meet.transvoice.ai/invite/${TOKEN}`
let n = 0
const recipient = () => `partner${++n}@example.com`
let me = 'host-0'
const validInvitation = (overrides = {}) => ({
  inviter_id: me,
  sponsor_window: '7 days',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  used_count: 0,
  max_uses: 1,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://meet.transvoice.ai'
  mailerKind = 'resend'
  supabaseFallback = false
  ip = `203.0.113.${++n}`
  me = `host-${n}` // the per-user limit is process-wide: one user per test
  getSessionUser.mockResolvedValue({ id: me, email: 'host@example.com' })
  invitationRow.mockReturnValue(validInvitation())
  send.mockResolvedValue(undefined)
  inviteUserByEmail.mockResolvedValue({ data: {}, error: null })
})
afterEach(cleanup)

describe('invite email template', () => {
  it('escapes the user-controlled inviter name everywhere', () => {
    const html = buildInviteEmailHtml({
      inviterName: '<a href="https://evil">Click</a>',
      inviteUrl: URL,
      expiresInLabel: '7 days',
    })
    expect(html).not.toContain('<a href="https://evil">')
    expect(html).toContain(
      '&lt;a href=&quot;https://evil&quot;&gt;Click&lt;/a&gt; invited you to a meeting',
    )
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;')
  })

  it('is branded and links the CTA to the invite URL', () => {
    const html = buildInviteEmailHtml({
      inviterName: 'Atik',
      inviteUrl: URL,
      expiresInLabel: '24 hours',
    })
    for (const part of [
      '#0b0f17',
      '#111827',
      '#1e293b',
      '#22d3ee',
      '#facc15',
      'TRANSVOICE',
      'Meet without limits',
    ]) {
      expect(html).toContain(part)
    }
    expect(html).toMatch(new RegExp(`<a href="${URL}"[^>]*>\\s*Accept invitation &amp; join`))
    expect(html).toContain('valid for 24 hours')
    expect(
      buildInviteEmailText({ inviterName: 'Atik', inviteUrl: URL, expiresInLabel: '24 hours' }),
    ).toContain(URL)
  })

  it('keeps the subject a single safe line', () => {
    expect(inviteEmailSubject({ inviterName: 'Atik\r\nBcc: x@evil' })).toBe(
      'Atik Bcc: x@evil invited you to a TransVoice AI meeting',
    )
  })
})

describe('sendInvitationEmail', () => {
  it('sends the branded HTML with the app mailer to any address and logs a line without the address', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const to = recipient()
    expect(await sendInvitationEmail({ inviteUrl: URL, email: to.toUpperCase() })).toEqual({
      ok: true,
      to,
      via: 'resend',
    })
    const email = send.mock.calls[0]![0]
    expect(email.to).toBe(to)
    expect(email.subject).toBe('Atik <b>Islam</b> invited you to a TransVoice AI meeting')
    expect(email.html).toContain('Atik &lt;b&gt;Islam&lt;/b&gt;')
    expect(email.html).toContain(`href="https://meet.transvoice.ai/invite/${TOKEN}"`)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    const line = String(info.mock.calls.find((c) => String(c[0]).includes('invite_email'))![0])
    expect(JSON.parse(line)).toEqual({ event: 'invite_email', ok: true, via: 'resend' })
    info.mockRestore()
  })

  it('rebuilds the link from the token: a foreign URL with the same token sends our URL', async () => {
    await sendInvitationEmail({
      inviteUrl: `https://evil.example/invite/${TOKEN}`,
      email: recipient(),
    })
    expect(send.mock.calls[0]![0].html).toContain(
      `href="https://meet.transvoice.ai/invite/${TOKEN}"`,
    )
    expect(send.mock.calls[0]![0].html).not.toContain('evil.example')
  })

  it('without a mailer, says email is not configured: nothing is sent, nothing goes through Supabase', async () => {
    mailerKind = null
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const to = recipient()
    expect(await sendInvitationEmail({ inviteUrl: URL, email: to })).toEqual({
      ok: false,
      code: 'NOT_CONFIGURED',
      error:
        'Email sending is not configured on this server. Copy the link or share it with WhatsApp or LinkedIn.',
    })
    expect(send).not.toHaveBeenCalled()
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(String(warn.mock.calls[0]![0])).toContain('"reason":"not_configured"')
    expect(String(warn.mock.calls[0]![0])).not.toContain(to)
    warn.mockRestore()
  })

  it('with INVITE_EMAIL_SUPABASE_FALLBACK=true and no mailer, uses Supabase inviteUserByEmail with the invite in metadata', async () => {
    mailerKind = null
    supabaseFallback = true
    const to = recipient()
    expect(await sendInvitationEmail({ inviteUrl: URL, email: to })).toEqual({
      ok: true,
      to,
      via: 'supabase',
    })
    expect(inviteUserByEmail).toHaveBeenCalledWith(to, {
      redirectTo: 'https://meet.transvoice.ai/auth/confirm',
      data: { inviter_name: 'Atik <b>Islam</b>', invite_url: URL, invite_path: `/invite/${TOKEN}` },
    })
  })

  it('explains that existing users need the link (Supabase only invites new users)', async () => {
    mailerKind = null
    supabaseFallback = true
    inviteUserByEmail.mockResolvedValue({
      data: null,
      error: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
      },
    })
    expect(await sendInvitationEmail({ inviteUrl: URL, email: recipient() })).toMatchObject({
      ok: false,
      code: 'ALREADY_REGISTERED',
    })
  })

  it.each([
    ['someone else’s invitation', { inviter_id: 'other' }],
    ['a revoked invitation', { revoked_at: '2026-10-01' }],
    ['an expired invitation', { expires_at: '2020-01-01T00:00:00Z' }],
    ['a used invitation', { used_count: 1 }],
  ])('refuses %s', async (_label, overrides) => {
    invitationRow.mockReturnValue(validInvitation(overrides))
    expect(await sendInvitationEmail({ inviteUrl: URL, email: recipient() })).toMatchObject({
      code: 'NOT_YOURS',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('looks the invitation up by token hash', async () => {
    const lookups: string[] = []
    invitationRow.mockImplementation(() => {
      lookups.push('invitations')
      return validInvitation()
    })
    await sendInvitationEmail({ inviteUrl: URL, email: recipient() })
    expect(lookups).toEqual(['invitations'])
    expect(createHash('sha256').update(TOKEN).digest('hex')).toHaveLength(64)
  })

  it('validates input and refuses your own address', async () => {
    expect(await sendInvitationEmail({ inviteUrl: URL, email: 'nope' })).toMatchObject({
      code: 'INVALID',
    })
    expect(
      await sendInvitationEmail({ inviteUrl: 'https://meet.transvoice.ai/x', email: recipient() }),
    ).toMatchObject({
      code: 'INVALID',
    })
    expect(await sendInvitationEmail({ inviteUrl: URL, email: 'HOST@example.com' })).toMatchObject({
      code: 'INVALID',
    })
    getSessionUser.mockResolvedValue(null)
    expect(await sendInvitationEmail({ inviteUrl: URL, email: recipient() })).toMatchObject({
      code: 'SIGNED_OUT',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('rate-limits: 3 emails a day to the same recipient', async () => {
    const to = recipient()
    for (let i = 0; i < 3; i++) {
      ip = `198.51.100.${n * 4 + i}`
      expect((await sendInvitationEmail({ inviteUrl: URL, email: to })).ok).toBe(true)
    }
    expect(await sendInvitationEmail({ inviteUrl: URL, email: to })).toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('reports a mailer failure without leaking details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    send.mockRejectedValue(new Error('SMTP EAUTH 535: Authentication failed'))
    const to = recipient()
    const result = await sendInvitationEmail({ inviteUrl: URL, email: to })
    expect(result).toEqual({
      ok: false,
      code: 'FAILED',
      error: 'The email could not be sent (the mail provider refused it). Share the link instead.',
    })
    // The log gets the provider's reason, never the recipient or the message.
    const line = String(error.mock.calls[0]![0])
    expect(JSON.parse(line)).toMatchObject({ event: 'invite_email', ok: false, via: 'resend' })
    expect(line).toContain('Authentication failed')
    expect(line).not.toContain(to)
    error.mockRestore()
  })
})

describe('Invite Partner modal: Send invite by email', () => {
  it('shows the email field once the link exists, then sending and success', async () => {
    vi.doMock('@/app/invite/actions', () => ({
      createInvitation: vi.fn(async () => ({
        ok: true,
        url: URL,
        meetingId: 'm1',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })),
      sendInvitationEmail: vi.fn(async ({ email }: { email: string }) => ({
        ok: true,
        to: email,
        via: 'smtp',
      })),
    }))
    vi.resetModules()
    const { InviteModal } = await import('@/components/invite/invite-modal')
    render(<InviteModal meetingId="11111111-1111-4111-8111-111111111111" onClose={() => {}} />)
    expect(screen.queryByPlaceholderText('partner@example.com')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    const input = await screen.findByPlaceholderText('partner@example.com')
    fireEvent.change(input, { target: { value: 'rahim@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Send Invite/ }))
    expect(await screen.findByText('Invitation sent to rahim@example.com.')).toBeInTheDocument()
    vi.doUnmock('@/app/invite/actions')
  })

  it('shows errors inline', async () => {
    vi.doMock('@/app/invite/actions', () => ({
      createInvitation: vi.fn(async () => ({
        ok: true,
        url: URL,
        meetingId: 'm1',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })),
      sendInvitationEmail: vi.fn(async () => ({
        ok: false,
        code: 'ALREADY_REGISTERED',
        error: 'This person already has an account. Send them the link with Copy or WhatsApp.',
      })),
    }))
    vi.resetModules()
    const { InviteModal } = await import('@/components/invite/invite-modal')
    render(<InviteModal meetingId="11111111-1111-4111-8111-111111111111" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }))
    fireEvent.change(await screen.findByPlaceholderText('partner@example.com'), {
      target: { value: 'known@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send Invite/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already has an account')
    vi.doUnmock('@/app/invite/actions')
  })
})
