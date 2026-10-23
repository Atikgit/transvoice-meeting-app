export interface ChatMessage {
  id: string
  sender: string
  text: string
  time: string
}

export interface TranslationCaption {
  original: string
  translated: string
  /** Base64 WAV TTS audio. */
  audio?: string
}

/** Shared meeting state, broadcast by the host on the room channel. */
export type SessionState =
  { status: 'ready' } | { status: 'live'; sessionId: string; startedAt: string }
