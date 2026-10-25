/**
 * Who may use live translation until the Phase 3 minute meter exists.
 *
 * TRANSLATION_BETA_ALLOWLIST — comma-separated emails of meeting HOSTS:
 *   unset            → private beta for DEFAULT_BETA_ALLOWLIST (fail-closed)
 *   a@x.com,b@y.com  → only meetings hosted by these emails translate
 *   *                → open to everyone
 * On top of that, the speaker's payer must have available minutes.
 */
export const DEFAULT_BETA_ALLOWLIST = ['codera1a1@gmail.com']

export const BETA_MESSAGE = 'Live translation is in private beta.'

export function parseAllowlist(raw: string | undefined): { open: boolean; emails: string[] } {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (entries.length === 0) return { open: false, emails: DEFAULT_BETA_ALLOWLIST }
  if (entries.includes('*')) return { open: true, emails: [] }
  return { open: false, emails: entries }
}

/** Is the meeting's host allowed to have translation? */
export function betaAllows(hostEmail: string | null | undefined, raw: string | undefined): boolean {
  const { open, emails } = parseAllowlist(raw)
  return open || (Boolean(hostEmail) && emails.includes(hostEmail!.trim().toLowerCase()))
}

export type GateDecision =
  | { ok: true }
  | {
      ok: false
      status: 403 | 402
      code: 'DISABLED' | 'BETA' | 'PAYER_NO_MINUTES'
      error: string
    }

export const DISABLED_MESSAGE =
  'Live translation is switched off. Video, voice and chat still work.'

export function translationGate({
  hostEmail,
  payerHasMinutes,
  speakerIsPayer,
  allowlist,
  enabled = true,
}: {
  enabled?: boolean
  hostEmail: string | null | undefined
  payerHasMinutes: boolean
  speakerIsPayer: boolean
  allowlist: string | undefined
}): GateDecision {
  if (!enabled) return { ok: false, status: 403, code: 'DISABLED', error: DISABLED_MESSAGE }
  if (!betaAllows(hostEmail, allowlist)) {
    return { ok: false, status: 403, code: 'BETA', error: BETA_MESSAGE }
  }
  if (!payerHasMinutes) {
    return {
      ok: false,
      status: 402,
      code: 'PAYER_NO_MINUTES',
      error: speakerIsPayer
        ? 'You have no minutes left. Get minutes to keep translating; chat still works.'
        : "The host's minutes have run out. Translation is paused; chat still works.",
    }
  }
  return { ok: true }
}
