import 'server-only'

/**
 * One structured line per utterance with stage timings (ms). Deliberately free of anything
 * personal: no transcript or translated text, no audio, no user or speaker ids.
 */
export interface TranslateLog {
  sessionId: string
  audioBytes: number
  /** Auth, rate limit, upload parsing. */
  intakeMs: number
  /** translation_context + LiveKit participants. */
  contextMs: number
  languages: {
    lang: string
    outcome: 'speech' | 'silence' | 'failed'
    reason?: string
    /** TransVoice API round trip (incl. retry). */
    apiMs: number
    /** API result → caption sent. */
    captionMs?: number
    /** API result → audio message sent (TTS cached). */
    audioMs?: number
  }[]
  totalMs: number
}

export function logTranslate(entry: TranslateLog): void {
  console.info(JSON.stringify({ event: 'translate', ...entry }))
}
