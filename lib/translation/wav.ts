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
