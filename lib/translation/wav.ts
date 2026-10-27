/** 16 kHz mono 16-bit PCM WAV — what the VAD produces and the TransVoice API accepts. */
export const WAV_SAMPLE_RATE = 16_000

/** Encodes [-1, 1] float samples as a little-endian PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** True for a RIFF/WAVE header (cheap check that an upload really is WAV audio). */
export function isWav(bytes: Uint8Array): boolean {
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  return bytes.length >= 44 && tag(0) === 'RIFF' && tag(8) === 'WAVE'
}

/** Seconds of 16-bit mono audio in a WAV file of `bytes` length. */
export function wavSeconds(byteLength: number, sampleRate = WAV_SAMPLE_RATE): number {
  return Math.max(0, byteLength - 44) / 2 / sampleRate
}

export interface WavStats {
  sampleRate: number
  channels: number
  bitsPerSample: number
  seconds: number
  /** Largest absolute sample, 0..1. */
  peak: number
  /** Root-mean-square level, 0..1. */
  rms: number
}

/** Header fields and loudness of a 16-bit PCM WAV; null when it is not one. Never throws. */
export function analyseWav(bytes: Uint8Array): WavStats | null {
  if (!isWav(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)
  if (bitsPerSample !== 16 || channels < 1 || sampleRate < 1) return null
  const frames = Math.floor((bytes.length - 44) / 2)
  let peak = 0
  let sum = 0
  for (let i = 0; i < frames; i++) {
    const v = Math.abs(view.getInt16(44 + i * 2, true)) / 0x8000
    if (v > peak) peak = v
    sum += v * v
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    seconds: frames / channels / sampleRate,
    peak,
    rms: frames > 0 ? Math.sqrt(sum / frames) : 0,
  }
}

/** Below this the clip is inaudible; shorter than MIN_CLIP_SECONDS it is a click, not speech. */
export const MIN_CLIP_PEAK = 0.01
export const MIN_CLIP_SECONDS = 0.2

export type ClipIssue = 'missing' | 'empty' | 'silent' | 'invalid'

/** Why a clip must not be played, or null when it is usable. */
export function clipIssue(stats: WavStats | null, bytes: number): ClipIssue | null {
  if (bytes === 0) return 'missing'
  if (!stats) return 'invalid'
  if (stats.seconds < MIN_CLIP_SECONDS) return 'empty'
  if (stats.peak < MIN_CLIP_PEAK) return 'silent'
  return null
}
