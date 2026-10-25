'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { appMailer } from '@/lib/email/mailer'
import {
  buildInviteEmailHtml,
  buildInviteEmailText,
  inviteEmailSubject,
} from '@/lib/email/invite-template'
import { appOrigin, clientIp } from '@/lib/http/request'
import { createInviteToken, hashInviteToken, isInviteToken } from '@/lib/invitations/token'
import { INVITE_WINDOWS, inviteWindow, type InviteWindowId } from '@/lib/invitations/windows'
import { checkRateLimit, checkRateLimits } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export type CreateInvitationResult =
  | { ok: true; url: string; meetingId: string; expiresAt: string; reused: boolean }
  | {
      ok: false
      code: 'SIGNED_OUT' | 'NO_MINUTES' | 'EMAIL_NOT_VERIFIED' | 'RATE_LIMITED' | 'FAILED'
      error: string
    }

const createSchema = z.object({
  window: z.enum(INVITE_WINDOWS.map((w) => w.id) as [InviteWindowId, ...InviteWindowId[]]),
  meetingId: z.uuid().optional(),
})

const MESSAGES = {
  SIGNED_OUT: 'Please sign in again.',
  NO_MINUTES: 'You have no minutes left. Get minutes to invite a partner.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before inviting partners.',
  RATE_LIMITED: 'You have created many links in the last hour. Please try again later.',
  FAILED: 'Could not create the link. Please try again.',
} as const

/**
 * Creates an invitation for the signed-in user. Without meetingId it joins the host's current
 * meeting (open session, or a fresh one not yet used) and only creates a new meeting if there is none.
 * The raw token appears only in the returned URL; the database stores its hash.
 */
export async function createInvitation(input: {
  window: InviteWindowId
  meetingId?: string
}): Promise<CreateInvitationResult> {
  const fail = (code: keyof typeof MESSAGES) =>
    ({ ok: false, code, error: MESSAGES[code] }) as const

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return fail('FAILED')
  const user = await getSessionUser()
  if (!user) return fail('SIGNED_OUT')
  if (!(await checkRateLimit('invitation', user.id))) return fail('RATE_LIMITED')

  const { token, hash } = createInviteToken()
  const { data, error } = await createAdminClient().rpc('create_invitation', {
    p_user: user.id,
    p_token_hash: hash,
    p_window: inviteWindow(parsed.data.window).interval,
    p_meeting: parsed.data.meetingId,
  })
  if (error || !data?.[0]) {
    const known = (['NO_MINUTES', 'EMAIL_NOT_VERIFIED'] as const).find((code) =>
      error?.message.includes(code),
    )
    if (!known) console.error('create_invitation failed:', error?.message)
    return fail(known ?? 'FAILED')
  }

  return {
    ok: true,
    url: `${await appOrigin()}/invite/${token}`,
    meetingId: data[0].meeting_id,
    expiresAt: data[0].expires_at,
    // true: the link opens a meeting the host already has (not a new one).
    reused: data[0].reused,
  }
}

/** Accepts the invitation in `token` for the signed-in user, then opens the meeting lobby. */
export async function acceptInvitation(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  if (!isInviteToken(token)) redirect('/dashboard')

  const user = await getSessionUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)

  const { data: meetingId, error } = await createAdminClient().rpc('accept_invitation', {
    p_token_hash: hashInviteToken(token),
    p_user: user.id,
  })
  if (error || !meetingId) {
    const reason = /INVITE_(EXPIRED|REVOKED|USED|NOT_FOUND)/.exec(error?.message ?? '')?.[1]
    if (!reason) console.error('accept_invitation failed:', error?.message)
    redirect(`/invite/${token}?error=${(reason ?? 'failed').toLowerCase()}`)
  }
  redirect(`/m/${meetingId}/lobby`)
}

export type SendInviteEmailResult =
  | { ok: true; to: string; via: 'resend' | 'smtp' | 'supabase' }
  | {
      ok: false
      code:
        'SIGNED_OUT' | 'INVALID' | 'RATE_LIMITED' | 'NOT_YOURS' | 'ALREADY_REGISTERED' | 'FAILED'
      error: string
    }

const emailSchema = z.object({
  inviteUrl: z.string().max(300),
  email: z.email('Enter a valid email address.').max(254),
})

/** PostgREST interval text → the label shown when the link was created. */
const WINDOW_LABELS: Record<string, string> = {
  '01:00:00': '1 hour',
  '1 hour': '1 hour',
  '24:00:00': '24 hours',
  '1 day': '24 hours',
  '7 days': '7 days',
  '30 days': '30 days',
}

/**
 * Invite Partner → "Send invite by email". Only for an invitation the signed-in user created
 * that is still usable; the link in the email is rebuilt from the token on the server.
 * Branded HTML via the app's mailer (Resend/SMTP, any recipient); without one, Supabase's
 * "Invite user" email (people without an account only). Rate-limited per user, IP, recipient.
 */
export async function sendInvitationEmail(input: {
  inviteUrl: string
  email: string
}): Promise<SendInviteEmailResult> {
  const parsed = emailSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID',
      error: parsed.error.issues[0]?.message ?? 'Check the email.',
    }
  }
  const token = /\/invite\/([A-Za-z0-9_-]{43})$/.exec(parsed.data.inviteUrl)?.[1]
  if (!token || !isInviteToken(token)) {
    return { ok: false, code: 'INVALID', error: 'Create the invite link first.' }
  }
  const to = parsed.data.email.trim().toLowerCase()

  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'SIGNED_OUT', error: 'Please sign in again.' }
  if (user.email?.toLowerCase() === to) {
    return { ok: false, code: 'INVALID', error: 'Enter your partner’s email, not your own.' }
  }

  const limited =
    !(await checkRateLimits('inviteEmailUser', [user.id])) ||
    !(await checkRateLimits('inviteEmailIp', [await clientIp()])) ||
    !(await checkRateLimits('inviteEmailRecipient', [to]))
  if (limited) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Too many invitation emails. Please try again later or share the link.',
    }
  }

  const admin = createAdminClient()
  const { data: invitation } = await admin
    .from('invitations')
    .select('inviter_id, sponsor_window, expires_at, revoked_at, used_count, max_uses')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (
    !invitation ||
    invitation.inviter_id !== user.id ||
    invitation.revoked_at ||
    Date.parse(invitation.expires_at) <= Date.now() ||
    invitation.used_count >= invitation.max_uses
  ) {
    return {
      ok: false,
      code: 'NOT_YOURS',
      error: 'This invite link can no longer be sent. Create a new one.',
    }
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle()
  const inviterName = profile?.full_name || user.email?.split('@')[0] || 'Your partner'
  const inviteUrl = `${await appOrigin()}/invite/${token}`
  const email = {
    inviterName,
    inviteUrl,
    expiresInLabel: WINDOW_LABELS[invitation.sponsor_window] ?? 'a limited time',
  }

  const mailer = appMailer()
  if (mailer) {
    try {
      await mailer.send({
        to,
        subject: inviteEmailSubject(email),
        html: buildInviteEmailHtml(email),
        text: buildInviteEmailText(email),
      })
      return { ok: true, to, via: mailer.kind }
    } catch (error) {
      console.error(
        `Invite email via ${mailer.kind} failed:`,
        error instanceof Error ? error.message : error,
      )
      return {
        ok: false,
        code: 'FAILED',
        error: 'Could not send the email. Share the link instead.',
      }
    }
  }

  // No app mailer: Supabase "Invite user" (creates an unconfirmed account for a new address).
  const { error } = await admin.auth.admin.inviteUserByEmail(to, {
    redirectTo: `${await appOrigin()}/auth/confirm`,
    data: { inviter_name: inviterName, invite_url: inviteUrl, invite_path: `/invite/${token}` },
  })
  if (error) {
    if (error.code === 'email_exists' || /already (been )?registered/i.test(error.message)) {
      return {
        ok: false,
        code: 'ALREADY_REGISTERED',
        error: 'This person already has an account. Send them the link with Copy or WhatsApp.',
      }
    }
    console.error('inviteUserByEmail failed:', error.code ?? error.message)
    return { ok: false, code: 'FAILED', error: 'Could not send the email. Share the link instead.' }
  }
  return { ok: true, to, via: 'supabase' }
}
