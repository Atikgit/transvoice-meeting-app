import { muxOggOpus } from '@/lib/translation/ogg'

/** Opus bitrate for speech: clear voice at ~3 KB per second. */
const BITRATE = 24_000

/**
 * Encodes 16 kHz mono samples as Ogg Opus with the browser's WebCodecs AudioEncoder (about a
 * tenth of the WAV's size). Returns null where that is not possible (no AudioEncoder, Opus not
 * supported, an encoder error): the caller then sends WAV, so Opus is never a point of failure.
 */
export async function encodeOpus(
  samples: Float32Array,
  sampleRate = 16_000,
): Promise<Uint8Array | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null
  try {
    const config = { codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: BITRATE } as const
    if (!(await AudioEncoder.isConfigSupported(config)).supported) return null
    const packets: { data: Uint8Array; durationUs: number }[] = []
    let failure: unknown = null
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        packets.push({ data, durationUs: chunk.duration ?? 20_000 })
      },
      error: (error) => (failure = error),
    })
    encoder.configure(config)
    encoder.encode(
      new AudioData({
        format: 'f32',
        sampleRate,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp: 0,
        data: samples as Float32Array<ArrayBuffer>,
      }),
    )
    await encoder.flush()
    encoder.close()
    if (failure || packets.length === 0) return null
    return muxOggOpus(packets, sampleRate)
  } catch {
    return null
  }
}
