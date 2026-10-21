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
