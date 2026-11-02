import { z } from 'zod'

/**
 * What the speaker's device knew when an utterance started: used to tell whether the microphone
 * could have heard the other person (speaker bleed) while this one was "speaking". Measured in the
 * browser, sent with the last chunk (header x-capture-ctx) or the whole upload (form field
 * captureCtx), and written to the translate log. Numbers only: no audio, no text.
 *
 *   vadMs   duration of the speech as the VAD saw it (start to end, without the end-of-speech wait)
 *   clipMs  a translated clip is playing here (0) or ended this many ms before speech start (<= 1500); null = not within 1.5 s
 *   voiceMs the partner's original voice is audible here (0) or was this many ms before speech start (<= 1500); null = not
 *   micDb   loudness of the local microphone (rms, dBFS) in the 300 ms before speech start
 *   outDb   loudness of the audio output (rms of the louder of the partner's voice and the translated clip, dBFS) in the same 300 ms
 */
export const captureContext = z.object({
  vadMs: z.number().int().min(0).max(120_000),
  clipMs: z.number().int().min(0).max(1500).nullable(),
  voiceMs: z.number().int().min(0).max(1500).nullable(),
  micDb: z.number().int().min(-120).max(0),
  outDb: z.number().int().min(-120).max(0),
})

export type CaptureContext = z.infer<typeof captureContext>

export const MAX_CAPTURE_CTX_CHARS = 200

export function encodeCaptureContext(ctx: CaptureContext): string {
  return JSON.stringify(ctx)
}

/** A malformed or oversized value is ignored (undefined): it must never fail an upload. */
export function parseCaptureContext(raw: unknown): CaptureContext | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CAPTURE_CTX_CHARS)
    return undefined
  try {
    const parsed = captureContext.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
