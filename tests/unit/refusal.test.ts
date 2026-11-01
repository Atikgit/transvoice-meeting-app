import { describe, expect, it } from 'vitest'
import { describeRefusal, GATE_REASON, refusalFromFailures } from '@/lib/translation/refusal'

describe('refusal reasons', () => {
  it('maps each gate code to one reason', () => {
    expect(GATE_REASON).toEqual({
      BETA: 'allowlist',
      DISABLED: 'switched_off',
      PAYER_NO_MINUTES: 'payer_minutes',
    })
  })

  it('picks the most specific cause among failed languages', () => {
    expect(refusalFromFailures([])).toBeNull()
    expect(refusalFromFailures([{ reason: 'error' }, { reason: 'error', status: 402 }])).toBe(
      'api_credit',
    )
    expect(refusalFromFailures([{ reason: 'error', status: 401 }])).toBe('api_key')
    expect(refusalFromFailures([{ reason: 'circuit_open' }, { reason: 'timeout' }])).toBe(
      'circuit_breaker',
    )
    expect(refusalFromFailures([{ reason: 'timeout' }])).toBe('service_error')
  })

  it('every reason has its own sentence that names the reason', () => {
    const texts = (
      [
        'allowlist',
        'switched_off',
        'payer_minutes',
        'api_credit',
        'api_key',
        'circuit_breaker',
        'service_error',
      ] as const
    ).map((r) => describeRefusal(r))
    expect(new Set(texts).size).toBe(7)
    expect(describeRefusal('payer_minutes', { payerIsSpeaker: true })).toContain(
      'you have no minutes',
    )
    expect(describeRefusal('payer_minutes')).toContain("host's minutes")
    expect(describeRefusal('api_credit')).toContain('(API credit)')
  })
})
