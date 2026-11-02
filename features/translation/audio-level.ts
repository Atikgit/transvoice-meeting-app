/**
 * Peak normalization of the microphone audio before it is uploaded for speech-to-text. A quiet
 * laptop microphone (about -50 dBFS) makes the STT return nothing or a phantom word, and the
 * utterance is then dropped as silence. Quiet speech is raised so its loudest sample reaches
 * TARGET_PEAK; loud speech is left alone. Pure logic, no browser APIs.
 *
 * autoGainControl stays on in the capture constraints; this is a second, deterministic stage.
 */
/** The loudest sample of a normalized speech (0..1). */
export const TARGET_PEAK = 0.7
/** Largest gain applied: +20 dB. */
export const MAX_GAIN = 10
/** Below this peak (-60 dBFS) there is nothing to raise but noise: gain 1. */
export const NOISE_FLOOR_PEAK = 0.001
/** VAD speech probability from which a frame counts as speech. */
const SPEECH_PROBABILITY = 0.5

export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!)
    if (v > peak) peak = v
  }
  return peak
}

function sumSquares(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!
  return sum
}

export function rmsOf(samples: Float32Array): number {
  return samples.length > 0 ? Math.sqrt(sumSquares(samples) / samples.length) : 0
}

/** Level in dBFS (0 = full scale); -120 for silence. */
export function toDb(level: number): number {
  return level > 1e-6 ? 20 * Math.log10(level) : -120
}

/** The gain for a speech whose loudest sample is `peak`: never below 1, never above MAX_GAIN. */
export function gainFor(peak: number): number {
  if (!(peak >= NOISE_FLOOR_PEAK)) return 1
  return Math.min(MAX_GAIN, Math.max(1, TARGET_PEAK / peak))
}

/** A copy of `samples` times `gain`, clamped to [-1, 1]. */
export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, Math.min(1, samples[i]! * gain))
  }
  return out
}

/** Normalizes a finished speech whose whole audio is known. */
export function normalizeSamples(samples: Float32Array): { samples: Float32Array; gain: number } {
  const gain = gainFor(peakOf(samples))
  return { samples: gain === 1 ? samples : applyGain(samples, gain), gain }
}

export interface LevelReport {
  prePeak: number
  postPeak: number
  preRms: number
  postRms: number
  gain: number
}

/** Short one-line form for the server log (POST /api/diag detail, at most 60 characters). */
export function formatLevels(report: LevelReport): string {
  const db = (v: number) => toDb(v).toFixed(1)
  return `pk ${db(report.prePeak)}>${db(report.postPeak)} rms ${db(report.preRms)}>${db(
    report.postRms,
  )} g ${toDb(report.gain).toFixed(1)}`
}

/**
 * Normalizes a speech frame by frame while it is being spoken (chunks leave the browser before the
 * speech ends, so its final peak is not known yet). The gain comes from the loudest speech frame
 * so far and can only go down during one speech; the frame that sets a new peak is already
 * brought to TARGET_PEAK, so a normalized frame never exceeds it. `reset()` ends the speech and
 * returns its levels (null when no frame counted as speech).
 */
export class SpeechGain {
  private peak = 0
  private gain = 1
  private prePeak = 0
  private postPeak = 0
  private preSum = 0
  private postSum = 0
  private count = 0

  frame(speechProbability: number, frame: Float32Array): Float32Array {
    const speech = speechProbability >= SPEECH_PROBABILITY
    if (speech) this.peak = Math.max(this.peak, peakOf(frame))
    this.gain = gainFor(this.peak)
    const out = this.gain === 1 ? frame : applyGain(frame, this.gain)
    if (speech) {
      this.prePeak = Math.max(this.prePeak, peakOf(frame))
      this.postPeak = Math.max(this.postPeak, peakOf(out))
      this.preSum += sumSquares(frame)
      this.postSum += sumSquares(out)
      this.count += frame.length
    }
    return out
  }

  reset(): LevelReport | null {
    const report: LevelReport | null =
      this.count > 0
        ? {
            prePeak: this.prePeak,
            postPeak: this.postPeak,
            preRms: Math.sqrt(this.preSum / this.count),
            postRms: Math.sqrt(this.postSum / this.count),
            gain: this.gain,
          }
        : null
    this.peak = 0
    this.gain = 1
    this.prePeak = 0
    this.postPeak = 0
    this.preSum = 0
    this.postSum = 0
    this.count = 0
    return report
  }
}
