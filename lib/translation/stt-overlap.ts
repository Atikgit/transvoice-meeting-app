import 'server-only'
import { transcribe } from '@/lib/transvoice/split-client'
import type { SplitConfig } from '@/lib/transvoice/split-client'

/**
 * Speech-to-text and the context lookup (participants, languages, payer gate) are independent, so
 * the speech-to-text can run while the context loads, but only for a speaker who has ALREADY passed
 * the gate in this session: the language STT needs comes from that earlier admission. A speaker who
 * was never admitted, or whose last attempt was refused, gets the sequential path, so a refused
 * speaker costs at most one wasted speech-to-text, never one per utterance. The result is thrown
 * away unless the fresh admission passes and agrees on the language.
 */
const HINT_TTL_MS = 5 * 60_000
const hints = new Map<string, { lang: string; expires: number }>()
const key = (sessionId: string, userId: string) => `${sessionId}:${userId}`

/** The Whisper language the speaker was last admitted with, or undefined (run sequentially). */
export function admittedLangHint(sessionId: string, userId: string): string | undefined {
  const hit = hints.get(key(sessionId, userId))
  if (!hit || hit.expires < Date.now()) {
    hints.delete(key(sessionId, userId))
    return undefined
  }
  return hit.lang
}

export function rememberAdmission(sessionId: string, userId: string, lang: string) {
  if (hints.size > 5000) hints.clear()
  hints.set(key(sessionId, userId), { lang, expires: Date.now() + HINT_TTL_MS })
}

/** A refused speaker loses the hint: the next utterance waits for admission before STT. */
export function forgetAdmission(sessionId: string, userId: string) {
  hints.delete(key(sessionId, userId))
}

export interface PreStarted {
  lang: string
  /** Never rejects: a failure is reported by the pipeline when it awaits the result. */
  result: Promise<{ text: string; durationS: number }>
}

export function startSpeechToText(
  config: SplitConfig,
  audioBase64: string,
  ext: 'wav' | 'ogg' | 'webm',
  lang: string,
  run: typeof transcribe = transcribe,
): PreStarted {
  const result = run(config, audioBase64, ext, lang)
  result.catch(() => {}) // observed here; the real consumer still sees the rejection
  return { lang, result }
}

export const __resetOverlapForTests = () => hints.clear()
