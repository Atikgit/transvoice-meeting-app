/**
 * Why an email or OAuth link failed, from Supabase Auth error codes
 * (https://supabase.com/docs/guides/auth/debugging/error-codes).
 *
 * Supabase reports an expired and an already-used token hash the same way (otp_expired), so
 * "expired" messages also tell users who already confirmed to just sign in.
 */
export type LinkFailure = 'expired' | 'used' | 'invalid'

const EXPIRED = new Set(['otp_expired', 'flow_state_expired'])
// The PKCE code was already exchanged (link opened twice, or prefetched by a mail scanner).
const USED = new Set(['flow_state_not_found'])

export function classifyLinkError(code: string | null | undefined): LinkFailure {
  if (code && EXPIRED.has(code)) return 'expired'
  if (code && USED.has(code)) return 'used'
  return 'invalid'
}

/** /login?error= value for a failed email confirmation. */
export function loginErrorFor(
  failure: LinkFailure,
): 'link_expired' | 'already_confirmed' | 'confirm' {
  return failure === 'expired'
    ? 'link_expired'
    : failure === 'used'
      ? 'already_confirmed'
      : 'confirm'
}

/** Marks /auth/callback links sent by email (not OAuth), so failures can be explained. */
export const EMAIL_FLOW_PARAM = 'flow'
