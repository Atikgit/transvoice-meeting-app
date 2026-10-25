import 'server-only'

/**
 * One structured line per utterance with stage timings (ms). Deliberately free of anything
 * personal: no transcript or translated text, no audio, no user or speaker ids.
 */
export interface TranslateLog {
  sessionId: string
  /** Random per utterance: joins this line with the clients' latency lines. */
  utteranceId: string
  audioBytes: number
  /** Auth, rate limit, upload parsing. */
  intakeMs: number
  /** translation_context + LiveKit participants. */
  contextMs: number
  languages: {
    lang: string
    /** "bn-BD>en-US": what was translated into what (language codes only). */
    pair: string
    outcome: 'speech' | 'silence' | 'failed'
    reason?: string
    /** HTTP status of a failed API call, null when there was no answer. */
    status?: number | null
    detail?: string
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

/**
 * What a client measured for one utterance (POST /api/latency). Ids are random per session and
 * utterance; no user id, text or audio. Times are milliseconds.
 */
export interface LatencyLog {
  sessionId: string
  utteranceId: string
  kind: 'speak' | 'listen'
  /** Listener's language (kind listen). */
  lang?: string
  /** speak: WAV encoding. */
  encodeMs?: number
  /** speak: upload start → answer received (includes the server's totalMs). */
  roundTripMs?: number
  bytes?: number
  /** listen: speech end → caption shown / first sound of the translated clip. */
  captionMs?: number
  audioMs?: number
  /** listen: how the clip arrived. */
  via?: 'url' | 'inline'
  /** listen: fetching + decoding the clip. */
  fetchMs?: number
}

export function logLatency(entry: LatencyLog): void {
  console.info(JSON.stringify({ event: 'latency', ...entry }))
}

/**
 * One line per /api/translate call, whatever happened to it, saying what the server decided and
 * from which stored values. Language codes only: no text, audio, emails or user ids.
 */
export interface DecisionLog {
  sessionId: string
  utteranceId: string
  /** translate | same_language | no_listeners | blocked:<CODE> | rejected:<CODE> */
  decision: string
  /** The speaker's stored spoken language (meeting_participants). */
  speakerLang?: string
  /** The stored listen language of every other participant that is connected. */
  listenerLangs?: string[]
  /** The locales the utterance is translated into. */
  targets?: string[]
}

export function logDecision(entry: DecisionLog): void {
  console.info(JSON.stringify({ event: 'translate_decision', ...entry }))
}
