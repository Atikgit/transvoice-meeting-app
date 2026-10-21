import { describe, expect, it } from 'vitest'
import { parseServerEnv } from '@/lib/env'
import { TEST_ENV } from '../mocks/env'

describe('parseServerEnv', () => {
  it('accepts a complete environment and applies config defaults', () => {
    const env = parseServerEnv({ ...TEST_ENV })
    expect(env).toMatchObject({
      BILLING_MODE: 'wallclock',
      LANG_MULTIPLIER_ENABLED: true,
      RECONNECT_GRACE_SEC: 60,
      AUTH_GOOGLE_ENABLED: false,
      AUTH_LINKEDIN_ENABLED: false,
    })
  })

  it('parses config overrides', () => {
    const env = parseServerEnv({
      ...TEST_ENV,
      LANG_MULTIPLIER_ENABLED: 'false',
      RECONNECT_GRACE_SEC: '30',
    })
    expect(env.LANG_MULTIPLIER_ENABLED).toBe(false)
    expect(env.RECONNECT_GRACE_SEC).toBe(30)
  })

  it('fails fast listing every missing secret', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _a, TRANSVOICE_MASTER_API_KEY: _b, ...partial } = TEST_ENV
    expect(() => parseServerEnv(partial)).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY[\s\S]*TRANSVOICE_MASTER_API_KEY/,
    )
  })

  it('treats empty values as unset', () => {
    const env = parseServerEnv({ ...TEST_ENV, LIVEKIT_URL: '', AUTH_GOOGLE_ENABLED: '' })
    expect(env.LIVEKIT_URL).toBeUndefined()
    expect(env.AUTH_GOOGLE_ENABLED).toBe(false)
    expect(() => parseServerEnv({ ...TEST_ENV, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
  })

  it('rejects an unknown billing mode', () => {
    expect(() => parseServerEnv({ ...TEST_ENV, BILLING_MODE: 'speech' })).toThrow(/BILLING_MODE/)
  })
})
