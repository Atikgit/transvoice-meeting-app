import { z } from 'zod'
import { BUILD_ID, PROTOCOL_VERSION } from '@/lib/build-id'

/** Server → client data messages (LiveKit sendData, reliable). Shared by server and client. */
export const TOPICS = {
  caption: 'tvx.caption',
  audio: 'tvx.audio',
  /** A small clip inside the packet itself (see encodeInlineAudio). */
  audioInline: 'tvx.audio.inline',
  notice: 'tvx.notice',
} as const

export interface CaptionMessage {
  /** Sender's protocol version and build (added by encodeMessage). */
  v?: number
  build?: string
  utteranceId: string
  speakerId: string
  lang: string
  original: string
  translated: string
  /** Speaker's wall clock (ms) when they stopped talking: listeners derive approximate latency. */
  speechEndedAt: number
}

export interface AudioMessage {
  /** Sender's protocol version and build (added by encodeMessage). */
  v?: number
  build?: string
  utteranceId: string
  speakerId: string
  lang: string
  /** Same-origin, short-lived, only for this message's recipients: /api/tts/<id> */
  url: string
  speechEndedAt: number
  /** Split pipeline: position of this clip within the utterance, and whether it is the last. */
  seq?: number
  last?: boolean
}

/** Header of an inline clip; the audio bytes follow it in the same packet. */
export interface InlineAudioHeader {
  /** Sender's protocol version and build (added by encodeMessage). */
  v?: number
  build?: string
  utteranceId: string
  speakerId: string
  lang: string
  format: 'wav' | 'mp3' | 'opus'
  speechEndedAt: number
  seq?: number
  last?: boolean
}

/**
 * Largest WHOLE inline packet (2-byte length + JSON header + raw audio, no base64), so a clip is
 * inline only when the packet as it goes on the wire is at most 14 KiB. LiveKit's reliable data
 * limit is 15 KiB per message; the 1 KiB margin covers the transport's own framing.
 */
export const MAX_INLINE_PACKET_BYTES = 14 * 1024
/** Kept for callers that only know the clip: the audio alone can never exceed the packet cap. */
export const MAX_INLINE_AUDIO_BYTES = MAX_INLINE_PACKET_BYTES

export interface NoticeMessage {
  /** Sender's protocol version and build (added by encodeMessage). */
  v?: number
  build?: string
  /** audio_unavailable: the caption arrived but its voice clip was empty (captions only). */
  kind: 'translation_unavailable' | 'audio_unavailable'
}

/** LiveKit reliable packets carry at most ~15 KiB of user data. */
export const MAX_PACKET_BYTES = 15 * 1024
/** Caption text cap per field (an utterance is ≤ 12 s, so real captions are far shorter). */
export const MAX_CAPTION_CHARS = 2000

/** Protocol version and build of the sender, added to every message. */
export const messageMeta = () => ({ v: PROTOCOL_VERSION, build: BUILD_ID })

export function encodeMessage(message: object): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...message, ...messageMeta() }))
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
  v: z.number().int().optional(),
  build: z.string().max(40).optional(),
  utteranceId: z.string(),
  speakerId: z.string(),
  lang: z.string(),
  original: z.string(),
  translated: z.string(),
  speechEndedAt: z.number(),
})
const audioSchema = z.object({
  v: z.number().int().optional(),
  build: z.string().max(40).optional(),
  utteranceId: z.string(),
  speakerId: z.string(),
  lang: z.string(),
  // Same-origin TTS path only: never fetch an arbitrary URL from a data message.
  url: z.string().regex(/^\/api\/tts\/[A-Za-z0-9_-]{24}$/),
  speechEndedAt: z.number(),
  seq: z.number().int().min(0).optional(),
  last: z.boolean().optional(),
})
const noticeSchema = z.object({
  v: z.number().int().optional(),
  build: z.string().max(40).optional(),
  kind: z.enum(['translation_unavailable', 'audio_unavailable']),
})

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

/**
 * Inline clip packet: 2 bytes big-endian header length, the JSON header, then the raw audio.
 * (Base64 inside JSON would make a 12 KiB clip 16 KiB, over the packet limit.)
 */
export function encodeInlineAudio(header: InlineAudioHeader, audio: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ ...header, ...messageMeta() }))
  if (2 + head.length + audio.length > MAX_INLINE_PACKET_BYTES)
    throw new Error('Inline clip too large')
  const packet = new Uint8Array(2 + head.length + audio.length)
  new DataView(packet.buffer).setUint16(0, head.length)
  packet.set(head, 2)
  packet.set(audio, 2 + head.length)
  if (packet.length > MAX_PACKET_BYTES)
    throw new Error(`Data packet too large: ${packet.length} bytes`)
  return packet
}

/** Size of the packet encodeInlineAudio would build, to decide inline vs URL before building it. */
export function inlinePacketSize(header: InlineAudioHeader, audioBytes: number): number {
  return (
    2 +
    new TextEncoder().encode(JSON.stringify({ ...header, ...messageMeta() })).length +
    audioBytes
  )
}

const inlineHeaderSchema = z.object({
  v: z.number().int().optional(),
  build: z.string().max(40).optional(),
  utteranceId: z.string(),
  speakerId: z.string(),
  lang: z.string(),
  format: z.enum(['wav', 'mp3', 'opus']),
  speechEndedAt: z.number(),
  seq: z.number().int().min(0).optional(),
  last: z.boolean().optional(),
})

/** Null for anything that is not a well-formed inline clip. */
export function decodeInlineAudio(
  packet: Uint8Array,
): { header: InlineAudioHeader; audio: Uint8Array } | null {
  if (packet.length < 3) return null
  const headLength = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint16(0)
  if (headLength === 0 || 2 + headLength >= packet.length) return null
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(packet.subarray(2, 2 + headLength)))
    const header = inlineHeaderSchema.safeParse(json)
    if (!header.success) return null
    return { header: header.data, audio: packet.subarray(2 + headLength) }
  } catch {
    return null
  }
}
