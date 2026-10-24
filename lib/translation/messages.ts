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
}

export interface AudioMessage {
  utteranceId: string
  speakerId: string
  lang: string
  /** Same-origin, short-lived, only for this message's recipients: /api/tts/<id> */
  url: string
  /** Server time when the clip was ready (clients drop clips older than 6 s). */
  readyAt: number
}

export interface NoticeMessage {
  kind: 'translation_unavailable' | 'translation_beta'
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
