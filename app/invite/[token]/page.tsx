import type { Metadata } from 'next'
import Link from 'next/link'
import { acceptInvitation } from '@/app/invite/actions'
import { AuthCard, FormMessage } from '@/components/auth/auth-card'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import { hashInviteToken, isInviteToken } from '@/lib/invitations/token'
import { LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Invitation' }

type InviteStatus = 'ok' | 'invalid' | 'expired' | 'revoked' | 'used'

const PROBLEMS: Record<Exclude<InviteStatus, 'ok'>, string> = {
  invalid: 'This invitation link is not valid. Check that you copied the whole link.',
  expired: 'This invitation has expired. Ask your partner to send you a new link.',
  revoked: 'This invitation was cancelled. Ask your partner to send you a new link.',
  used: 'This invitation link is full: everyone it allowed has already joined. Ask your partner for a new link.',
}

const ACCEPT_ERRORS: Record<string, InviteStatus> = {
  expired: 'expired',
  revoked: 'revoked',
  used: 'used',
  not_found: 'invalid',
}

const primaryClass =
  'flex w-full items-center justify-center rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200'
const secondaryClass =
  'flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[.09]'

/** Looks the invitation up by token hash (service role: clients cannot read token hashes). */
async function loadInvitation(token: string, userId: string | undefined) {
  if (!isInviteToken(token)) return { status: 'invalid' as const }
  const admin = createAdminClient()
  const { data: invitation } = await admin
    .from('invitations')
    .select('id, inviter_id, expires_at, revoked_at, used_count, max_uses')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (!invitation) return { status: 'invalid' as const }

  const { data: inviter } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', invitation.inviter_id)
    .maybeSingle()
  const inviterName = inviter?.full_name || 'Your partner'

  // Revoked and expired links stop working for everyone but the inviter, including people who
  // joined before. "Full" only stops NEW people: someone already in can always come back.
  let status: InviteStatus = 'ok'
  const own = userId === invitation.inviter_id
  const { data: accepted } = userId
    ? await admin
        .from('sponsored_connections')
        .select('id')
        .eq('invitation_id', invitation.id)
        .eq('guest_id', userId)
        .maybeSingle()
    : { data: null }
  if (!own) {
    if (invitation.revoked_at) status = 'revoked'
    else if (new Date(invitation.expires_at) <= new Date()) status = 'expired'
    else if (!accepted && invitation.used_count >= invitation.max_uses) status = 'used'
  }
  return { status, inviterName, returning: Boolean(accepted) || own }
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const { error } = await searchParams
  const user = await getSessionUser()
  const invitation = await loadInvitation(token, user?.id)
  const status = (typeof error === 'string' && ACCEPT_ERRORS[error]) || invitation.status
  const next = encodeURIComponent(`/invite/${token}`)

  if (status !== 'ok') {
    return (
      <AuthCard title="Invitation unavailable">
        <FormMessage tone="error">{PROBLEMS[status]}</FormMessage>
        <Link href={user ? '/dashboard' : '/login'} className={secondaryClass}>
          {user ? 'Go to your dashboard' : 'Sign in'}
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={
        invitation.returning
          ? `Welcome back: ${invitation.inviterName}'s translated meeting`
          : `${invitation.inviterName} invited you to a translated meeting`
      }
      subtitle={`Speak your language, hear theirs, with ${LANGUAGES_AND_VOICES}.`}
    >
      {user ? (
        <form action={acceptInvitation} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={primaryClass}>
            {invitation.returning ? 'Open the meeting' : 'Accept and join the meeting'}
          </button>
          <p className="text-center text-xs text-slate-500">
            Signed in as {user.email}. Your call minutes are covered by {invitation.inviterName} for
            this meeting.
          </p>
        </form>
      ) : (
        <div className="space-y-3">
          <Link href={`/signup?next=${next}`} className={primaryClass}>
            Sign up free: {FREE_TRIAL_MINUTES} free minutes
          </Link>
          <Link href={`/login?next=${next}`} className={secondaryClass}>
            I already have an account
          </Link>
          <p className="text-center text-xs text-slate-500">
            You need a free account to join. It takes less than a minute.
          </p>
        </div>
      )}
    </AuthCard>
  )
}
