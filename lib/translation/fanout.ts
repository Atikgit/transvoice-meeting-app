import 'server-only'
import { languageOptions, toApiLang } from '@/lib/transvoice/languages'
import { getVoiceName, type VoiceGender } from '@/lib/transvoice/voices'
import {
  TransVoiceApiError,
  translateSpeech,
  type TranslateSpeechInput,
  type TranslateSpeechResult,
} from '@/lib/transvoice/client'
import { transvoiceBreaker, type CircuitBreaker } from '@/lib/translation/breaker'

const whisperCode = new Map(languageOptions.map((l) => [l.code, l.whisper]))

/** API source language for the speaker: the Whisper code ("fil-PH" → "tl"), else "auto". */
export function sourceLang(spokenLang: string): string {
  return whisperCode.get(spokenLang) ?? 'auto'
}

/** Listeners grouped by target locale; listeners who share the speaker's language are left out. */
export function groupListeners(
  participants: { userId: string; listenLang: string }[],
  speakerSpokenLang: string,
): Map<string, string[]> {
  const speakerApi = toApiLang(speakerSpokenLang)
  const groups = new Map<string, string[]>()
  for (const { userId, listenLang } of participants) {
    if (toApiLang(listenLang) === speakerApi) continue // same language: original audio only
    groups.set(listenLang, [...(groups.get(listenLang) ?? []), userId])
  }
  return groups
}

export type LanguageResult =
  | {
      lang: string
      listeners: string[]
      kind: 'speech'
      originalText: string
      translatedText: string
      ttsAudio: string
      ms: number
    }
  | { lang: string; listeners: string[]; kind: 'silence'; ms: number }
  | {
      lang: string
      listeners: string[]
      kind: 'failed'
      reason: 'error' | 'timeout' | 'circuit_open'
      ms: number
    }

type Translate = (input: TranslateSpeechInput) => Promise<TranslateSpeechResult>

/** One call, retried once on a 5xx (not on timeouts: a late retry would be dropped anyway). */
async function translateWithRetry(translate: Translate, input: TranslateSpeechInput) {
  try {
    return await translate(input)
  } catch (error) {
    if (error instanceof TransVoiceApiError && error.status !== null && error.status >= 500) {
      return translate(input)
    }
    throw error
  }
}

/**
 * Translates one utterance for every listener language in parallel (Promise.allSettled).
 * Never throws; failures are reported per language.
 */
export async function translateForListeners({
  audioBase64,
  spokenLang,
  voiceGender,
  groups,
  sessionId,
  speakerId,
  translate = translateSpeech,
  breaker = transvoiceBreaker,
}: {
  audioBase64: string
  spokenLang: string
  voiceGender: VoiceGender
  groups: Map<string, string[]>
  sessionId: string
  speakerId: string
  translate?: Translate
  breaker?: CircuitBreaker
}): Promise<LanguageResult[]> {
  const entries = [...groups.entries()]
  const settled = await Promise.allSettled(
    entries.map(async ([lang, listeners]): Promise<LanguageResult> => {
      const started = performance.now()
      const ms = () => Math.round(performance.now() - started)
      if (!breaker.allow())
        return { lang, listeners, kind: 'failed', reason: 'circuit_open', ms: 0 }
      try {
        const result = await translateWithRetry(translate, {
          audio: audioBase64,
          srcLang: sourceLang(spokenLang),
          tgtLang: toApiLang(lang),
          azureVoice: getVoiceName(lang, voiceGender),
          sessionId,
          speakerId,
        })
        breaker.success()
        return result.kind === 'silence'
          ? { lang, listeners, kind: 'silence', ms: ms() }
          : { lang, listeners, ...result, ms: ms() }
      } catch (error) {
        breaker.failure()
        const timeout =
          error instanceof TransVoiceApiError && /timeout|aborted/i.test(error.message)
        return { lang, listeners, kind: 'failed', reason: timeout ? 'timeout' : 'error', ms: ms() }
      }
    }),
  )
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { lang: entries[i]![0], listeners: entries[i]![1], kind: 'failed', reason: 'error', ms: 0 },
  )
}
