/**
 * Latency from "speaker stopped talking" to what the listener sees and hears. The speaker's
 * clock (speechEndedAt) is compared with the listener's, so the numbers are approximate unless
 * both devices are NTP-synced (they are in a same-machine dev setup).
 */
export interface LatencySample {
  utteranceId: string
  /** Speech end → caption shown. */
  captionMs?: number
  /** Speech end → first sound of the translated clip. */
  audioMs?: number
}

export class LatencyTracker {
  private samples = new Map<string, LatencySample>()

  constructor(private readonly keep = 20) {}

  captionShown(utteranceId: string, speechEndedAt: number, now: number) {
    this.merge(utteranceId, { captionMs: Math.max(0, Math.round(now - speechEndedAt)) })
  }

  audioStarted(utteranceId: string, speechEndedAt: number, now: number) {
    this.merge(utteranceId, { audioMs: Math.max(0, Math.round(now - speechEndedAt)) })
  }

  latest(): LatencySample | null {
    return [...this.samples.values()].at(-1) ?? null
  }

  private merge(utteranceId: string, patch: Partial<LatencySample>) {
    this.samples.set(utteranceId, { ...this.samples.get(utteranceId), utteranceId, ...patch })
    while (this.samples.size > this.keep) this.samples.delete(this.samples.keys().next().value!)
  }
}
