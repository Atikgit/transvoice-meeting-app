'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { appOrigin } from '@/lib/http/request'
import { createInviteToken, hashInviteToken, isInviteToken } from '@/lib/invitations/token'
import { INVITE_WINDOWS, inviteWindow, type InviteWindowId } from '@/lib/invitations/windows'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export type CreateInvitationResult =
  | { ok: true; url: string; meetingId: string; expiresAt: string }
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
 * Creates an invitation (and, without meetingId, a new meeting) for the signed-in user.
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
