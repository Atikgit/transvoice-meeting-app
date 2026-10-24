import { describe, expect, it } from 'vitest'
import {
  BETA_MESSAGE,
  betaAllows,
  DEFAULT_BETA_ALLOWLIST,
  parseAllowlist,
  translationGate,
} from '@/lib/translation/gate'

describe('beta allowlist', () => {
  it('unset or empty falls back to the default private-beta list', () => {
    expect(parseAllowlist(undefined)).toEqual({ open: false, emails: DEFAULT_BETA_ALLOWLIST })
    expect(parseAllowlist('  , ')).toEqual({ open: false, emails: DEFAULT_BETA_ALLOWLIST })
    expect(betaAllows('codera1a1@gmail.com', undefined)).toBe(true)
    expect(betaAllows('someone@else.com', undefined)).toBe(false)
  })

  it('a list allows only meetings hosted by those emails, case-insensitively', () => {
    const raw = ' Host@Example.com , other@example.com '
    expect(betaAllows('host@example.com', raw)).toBe(true)
    expect(betaAllows('OTHER@example.com', raw)).toBe(true)
    expect(betaAllows('guest@example.com', raw)).toBe(false)
    expect(betaAllows(null, raw)).toBe(false)
    // The default owner is not implicitly included once a list is set.
    expect(betaAllows('codera1a1@gmail.com', raw)).toBe(false)
  })

  it('"*" opens translation to everyone', () => {
    expect(betaAllows('anyone@example.com', '*')).toBe(true)
    expect(betaAllows(null, '*')).toBe(true)
  })
})

describe('translationGate', () => {
  const base = {
    hostEmail: 'host@example.com',
    payerHasMinutes: true,
    speakerIsPayer: true,
    allowlist: 'host@example.com',
  }

  it('passes for an allow-listed host whose payer has minutes', () => {
    expect(translationGate(base)).toEqual({ ok: true })
  })

  it('others see "Live translation is in private beta."', () => {
    expect(translationGate({ ...base, hostEmail: 'x@example.com' })).toEqual({
      ok: false,
      status: 403,
      code: 'BETA',
      error: BETA_MESSAGE,
    })
  })

  it('needs minutes: the message differs for the payer and for a sponsored guest', () => {
    expect(translationGate({ ...base, payerHasMinutes: false })).toMatchObject({
      status: 402,
      code: 'PAYER_NO_MINUTES',
      error: expect.stringContaining('You have no minutes'),
    })
    expect(
      translationGate({ ...base, payerHasMinutes: false, speakerIsPayer: false }),
    ).toMatchObject({
      error: expect.stringContaining("host's minutes"),
    })
  })

  it('the beta check comes first (a non-beta meeting never learns the balance)', () => {
    expect(
      translationGate({ ...base, hostEmail: 'x@example.com', payerHasMinutes: false }),
    ).toMatchObject({ code: 'BETA' })
  })
})
