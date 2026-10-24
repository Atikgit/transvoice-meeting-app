import { z } from 'zod'

/** Server → client data messages (LiveKit sendData, reliable). Shared by server and client. */
export const TOPICS = {
  caption: 'tvx.caption',
  audio: 'tvx.audio',
  notice: 'tvx.notice',
} as const

export interface CaptionMessage {
  utteranceId: string
  speakerId: string
  lang: string
  original: string
  translated: string
  /** Speaker's wall clock (ms) when they stopped talking: listeners derive approximate latency. */
  speechEndedAt: number
}

export interface AudioMessage {
  utteranceId: string
  speakerId: string
  lang: string
  /** Same-origin, short-lived, only for this message's recipients: /api/tts/<id> */
  url: string
  speechEndedAt: number
}

export interface NoticeMessage {
  kind: 'translation_unavailable'
}

/** LiveKit reliable packets carry at most ~15 KiB of user data. */
export const MAX_PACKET_BYTES = 15 * 1024
/** Caption text cap per field (an utterance is ≤ 12 s, so real captions are far shorter). */
export const MAX_CAPTION_CHARS = 2000

export function encodeMessage(message: object): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(message))
  if (bytes.length > MAX_PACKET_BYTES)
    throw new Error(`Data packet too large: ${bytes.length} bytes`)
  return bytes
}

export function captionMessage(input: CaptionMessage): CaptionMessage {
  return {
    ...input,
    original: input.original.slice(0, MAX_CAPTION_CHARS),
    translated: input.translated.slice(0, MAX_CAPTION_CHARS),
  }
}

const captionSchema = z.object({
  utteranceId: z.string(),
  speakerId: z.string(),
  lang: z.string(),
  original: z.string(),
  translated: z.string(),
  speechEndedAt: z.number(),
})
const audioSchema = z.object({
  utteranceId: z.string(),
  speakerId: z.string(),
  lang: z.string(),
  // Same-origin TTS path only: never fetch an arbitrary URL from a data message.
  url: z.string().regex(/^\/api\/tts\/[A-Za-z0-9_-]{24}$/),
  speechEndedAt: z.number(),
})
const noticeSchema = z.object({ kind: z.literal('translation_unavailable') })

/** Decodes a data message by topic; null for unknown topics and malformed payloads. */
export function parseDataMessage(
  topic: string | undefined,
  payload: Uint8Array,
):
  | { topic: typeof TOPICS.caption; message: CaptionMessage }
  | { topic: typeof TOPICS.audio; message: AudioMessage }
  | { topic: typeof TOPICS.notice; message: NoticeMessage }
  | null {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    return null
  }
  if (topic === TOPICS.caption) {
    const parsed = captionSchema.safeParse(json)
    return parsed.success ? { topic, message: parsed.data } : null
  }
  if (topic === TOPICS.audio) {
    const parsed = audioSchema.safeParse(json)
    return parsed.success ? { topic, message: parsed.data } : null
  }
  if (topic === TOPICS.notice) {
    const parsed = noticeSchema.safeParse(json)
    return parsed.success ? { topic, message: parsed.data } : null
  }
  return null
}
