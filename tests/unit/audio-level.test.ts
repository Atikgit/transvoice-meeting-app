import { describe, expect, it } from 'vitest'
import {
  applyGain,
  formatLevels,
  gainFor,
  MAX_GAIN,
  NOISE_FLOOR_PEAK,
  normalizeSamples,
  peakOf,
  rmsOf,
  SpeechGain,
  TARGET_PEAK,
  toDb,
} from '@/features/translation/audio-level'
import { inputLevels } from '@/lib/translation/process'
import { encodeWav } from '@/lib/translation/wav'

/** A 200 Hz tone of `seconds` at 16 kHz whose loudest sample is `peak`. */
function tone(peak: number, seconds = 1): Float32Array {
  const out = new Float32Array(Math.round(16_000 * seconds))
  for (let i = 0; i < out.length; i++) out[i] = peak * Math.sin((2 * Math.PI * 200 * i) / 16_000)
  return out
}

const FRAME = 512

function frames(samples: Float32Array): Float32Array[] {
  const out: Float32Array[] = []
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) out.push(samples.subarray(i, i + FRAME))
  return out
}

describe('peak normalization constants', () => {
  it('targets 0.7, at most +20 dB, noise floor -60 dBFS', () => {
    expect(TARGET_PEAK).toBe(0.7)
    expect(MAX_GAIN).toBe(10)
    expect(toDb(MAX_GAIN)).toBeCloseTo(20, 5)
    expect(NOISE_FLOOR_PEAK).toBe(0.001)
    expect(toDb(NOISE_FLOOR_PEAK)).toBeCloseTo(-60, 5)
  })
})

describe('gainFor', () => {
  it.each([
    // [peak, gain]
    [0.0005, 1], // below the noise floor (-66 dBFS): left alone
    [0.00099, 1], // just below the floor
    [0.001, 10], // at the floor: 0.7 / 0.001 = 700, capped at +20 dB
    [0.005, 10], // -46 dBFS: 140 capped at 10, post peak 0.05
    [0.07, 10], // exactly 0.7 / 0.07 = 10
    [0.14, 5], // 0.7 / 0.14
    [0.35, 2], // 0.7 / 0.35
    [0.7, 1], // already at the target
    [0.9, 1], // louder than the target: never attenuated
    [1, 1],
  ])('peak %s -> gain %s', (peak, gain) => {
    expect(gainFor(peak)).toBeCloseTo(gain, 10)
  })

  it('treats silence and NaN as gain 1', () => {
    expect(gainFor(0)).toBe(1)
    expect(gainFor(Number.NaN)).toBe(1)
  })
})

describe('normalizeSamples (a finished speech)', () => {
  it('quiet fixture: peak 0.004 (-48 dBFS) becomes 0.04 (-28 dBFS), +20 dB', () => {
    const quiet = tone(0.004)
    const { samples, gain } = normalizeSamples(quiet)
    expect(gain).toBe(10)
    expect(peakOf(quiet)).toBeCloseTo(0.004, 5)
    expect(peakOf(samples)).toBeCloseTo(0.04, 4)
    expect(toDb(peakOf(samples)) - toDb(peakOf(quiet))).toBeCloseTo(20, 2)
    expect(rmsOf(samples)).toBeCloseTo(rmsOf(quiet) * 10, 5)
  })

  it('moderately quiet: peak 0.07 reaches the target 0.7 exactly', () => {
    const { samples, gain } = normalizeSamples(tone(0.07))
    expect(gain).toBeCloseTo(10, 6)
    expect(peakOf(samples)).toBeCloseTo(0.7, 4)
  })

  it('a loud speech and a noise-floor signal are returned untouched (same array)', () => {
    const loud = tone(0.8)
    expect(normalizeSamples(loud)).toEqual({ samples: loud, gain: 1 })
    expect(normalizeSamples(loud).samples).toBe(loud)
    const hiss = tone(0.0008)
    expect(normalizeSamples(hiss).samples).toBe(hiss)
  })

  it('applyGain clamps to [-1, 1] and does not change the input', () => {
    const input = Float32Array.from([0.5, -0.5, 0.1])
    const out = applyGain(input, 4)
    expect(Array.from(out)).toEqual([1, -1, expect.closeTo(0.4, 5)])
    expect(Array.from(input)).toEqual([0.5, -0.5, expect.closeTo(0.1, 5)])
  })
})

describe('SpeechGain (frame by frame while the person is still speaking)', () => {
  it('raises a quiet speech by +20 dB and reports the levels', () => {
    const gain = new SpeechGain()
    const out = frames(tone(0.004)).map((f) => gain.frame(0.9, f))
    expect(Math.max(...out.map(peakOf))).toBeCloseTo(0.04, 3)
    const report = gain.reset()!
    expect(report.gain).toBe(10)
    expect(report.prePeak).toBeCloseTo(0.004, 3)
    expect(report.postPeak).toBeCloseTo(0.04, 3)
    expect(report.postRms / report.preRms).toBeCloseTo(10, 3)
    expect(Math.round(toDb(report.prePeak))).toBe(-48)
    expect(Math.round(toDb(report.postPeak))).toBe(-28)
  })

  it('never lets a normalized frame go above the 0.7 target as the speech gets louder', () => {
    const gain = new SpeechGain()
    // 0.02 -> gain 10 (0.2); 0.1 -> gain 7 (0.7); 0.35 -> gain 2 (0.7). Gain only goes down.
    const input = [
      ...frames(tone(0.02, 0.2)),
      ...frames(tone(0.1, 0.2)),
      ...frames(tone(0.35, 0.2)),
    ]
    const out = input.map((f) => gain.frame(0.95, f))
    expect(Math.max(...out.map(peakOf))).toBeLessThanOrEqual(0.7 + 1e-6)
    const report = gain.reset()!
    expect(report.gain).toBeCloseTo(2, 6)
    expect(report.postPeak).toBeCloseTo(0.7, 3)
  })

  it('gives idle (non-speech) frames gain 1 and counts only speech frames in the report', () => {
    const gain = new SpeechGain()
    const noise = frames(tone(0.002, 0.2))
    for (const f of noise) expect(gain.frame(0.1, f)).toBe(f)
    expect(gain.reset()).toBeNull()
  })

  it('a speech under the noise floor is not amplified', () => {
    const gain = new SpeechGain()
    const f = frames(tone(0.0008, 0.2))[0]!
    expect(gain.frame(0.9, f)).toBe(f)
    expect(gain.reset()!.gain).toBe(1)
  })

  it('reset() starts the next speech from gain 1', () => {
    const gain = new SpeechGain()
    gain.frame(0.9, frames(tone(0.01, 0.1))[0]!)
    gain.reset()
    const loud = frames(tone(0.9, 0.1))[0]!
    expect(gain.frame(0.9, loud)).toBe(loud)
    expect(gain.reset()!.gain).toBe(1)
  })
})

describe('level log lines', () => {
  it('formatLevels is one short line (the /api/diag detail is at most 60 characters)', () => {
    const line = formatLevels({
      prePeak: 0.004,
      postPeak: 0.04,
      preRms: 0.0028,
      postRms: 0.028,
      gain: 10,
    })
    expect(line).toBe('pk -48.0>-28.0 rms -51.1>-31.1 g 20.0')
    expect(line.length).toBeLessThanOrEqual(60)
  })

  it('the server logs the peak and rms of the uploaded WAV (3 decimals)', () => {
    const wav = encodeWav(tone(0.5))
    const levels = inputLevels(wav)
    expect(levels.inputPeak).toBeCloseTo(0.5, 3)
    // rms of a sine is peak / sqrt(2) = 0.354
    expect(levels.inputRms).toBeCloseTo(0.354, 3)
    expect(inputLevels(Uint8Array.from([1, 2, 3]))).toEqual({})
  })

  it('the quiet fixture, normalized and encoded, reaches the server at -28 dBFS', () => {
    const { samples } = normalizeSamples(tone(0.004))
    const levels = inputLevels(encodeWav(samples))
    expect(levels.inputPeak).toBeCloseTo(0.04, 3)
    expect(Math.round(toDb(levels.inputPeak!))).toBe(-28)
  })
})
