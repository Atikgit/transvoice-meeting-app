/**
 * Circuit breaker for the TransVoice API: after `threshold` consecutive failures it opens for
 * `openMs` (calls are skipped, listeners get a "translation unavailable" notice), then lets one
 * trial call through (half-open).
 */
export class CircuitBreaker {
  private failures = 0
  private openedAt: number | null = null
  private trialInFlight = false

  constructor(
    private readonly threshold = 5,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed'
    return this.now() - this.openedAt >= this.openMs ? 'half-open' : 'open'
  }

  /** True if a call may go out now. */
  allow(): boolean {
    const state = this.state
    if (state === 'closed') return true
    if (state === 'half-open' && !this.trialInFlight) {
      this.trialInFlight = true
      return true
    }
    return false
  }

  success(): void {
    this.failures = 0
    this.openedAt = null
    this.trialInFlight = false
  }

  failure(): void {
    this.trialInFlight = false
    this.failures += 1
    if (this.failures >= this.threshold || this.openedAt !== null) this.openedAt = this.now()
  }
}

/** One breaker per server process for the TransVoice API. */
export const transvoiceBreaker = new CircuitBreaker()
