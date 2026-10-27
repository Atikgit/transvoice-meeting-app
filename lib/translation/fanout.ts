import 'server-only'
import {
  languageOptions,
  normalizeLocale,
  sameLanguage,
  toApiLang,
} from '@/lib/transvoice/languages'
import { findVoice, getVoiceName, otherGender, type VoiceGender } from '@/lib/transvoice/voices'
import { analyseWav, clipIssue, isWav, type ClipIssue } from '@/lib/translation/wav'
import { logClip } from '@/lib/translation/log'
import {
  TransVoiceApiError,
  type AudioFormat,
  translateSpeech,
  type TranslateSpeechInput,
  type TranslateSpeechResult,
} from '@/lib/transvoice/client'
import { transvoiceBreaker, type CircuitBreaker } from '@/lib/translation/breaker'

const whisperCode = new Map(languageOptions.map((l) => [l.code, l.whisper]))

/** API source language for the speaker: the Whisper code ("fil-PH" → "tl"), else "auto". */
export function sourceLang(spokenLang: string): string {
  return whisperCode.get(normalizeLocale(spokenLang)) ?? 'auto'
}

/** Listeners grouped by target locale; listeners who share the speaker's language are left out. */
export function groupListeners(
  participants: { userId: string; listenLang: string }[],
  speakerSpokenLang: string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const { userId, listenLang } of participants) {
    if (sameLanguage(listenLang, speakerSpokenLang)) continue // same language: original audio only
    const target = normalizeLocale(listenLang) // "en", "en_us", "en-US" are one group
    groups.set(target, [...(groups.get(target) ?? []), userId])
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
      /** Base64 audio; '' when no usable clip came back (see audioIssue): caption only. */
      ttsAudio: string
      audioFormat?: AudioFormat
      /** Why the audio was dropped, if it was. */
      audioIssue?: ClipIssue | 'no_voice'
      ms: number
    }
  | { lang: string; listeners: string[]; kind: 'silence'; ms: number }
  | {
      lang: string
      listeners: string[]
      kind: 'failed'
      reason: 'error' | 'timeout' | 'circuit_open'
      /** HTTP status of the API's answer (401 = wrong key, 404 = wrong URL…), null = no answer. */
      status?: number | null
      /** Short error text without any content (e.g. "fetch failed"), for the log. */
      detail?: string
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
 * Translates one utterance for every listener language in parallel (Promise.allSettled) and
 * hands each result to `onResult` as soon as it is ready. Never throws; failures are reported
 * per language (a delivery error is logged, it does not turn a translation into a failure).
 */
export async function translateForListeners({
  audioBase64,
  spokenLang,
  voiceGender,
  groups,
  sessionId,
  speakerId,
  utteranceId = '',
  translate = translateSpeech,
  breaker = transvoiceBreaker,
  onResult,
}: {
  audioBase64: string
  spokenLang: string
  voiceGender: VoiceGender
  groups: Map<string, string[]>
  sessionId: string
  speakerId: string
  /** Joins the clip log lines with the utterance's other log lines. */
  utteranceId?: string
  translate?: Translate
  breaker?: CircuitBreaker
  /** Called as soon as each language finishes (deliver without waiting for the slowest). */
  onResult?: (result: LanguageResult) => Promise<unknown> | void
}): Promise<LanguageResult[]> {
  const audioProblem = (r: Extract<TranslateSpeechResult, { kind: 'speech' }>) => {
    const bytes = Buffer.from(r.ttsAudio, 'base64')
    // Only WAV can be measured here; a compressed format is judged by size alone.
    if (bytes.length > 0 && !isWav(bytes) && r.audioFormat && r.audioFormat !== 'wav')
      return bytes.length < 200 ? ('empty' as const) : null
    return clipIssue(analyseWav(bytes), bytes.length)
  }
  const translateOne = async (lang: string, listeners: string[]): Promise<LanguageResult> => {
    const started = performance.now()
    const ms = () => Math.round(performance.now() - started)
    const logClipOf = (
      r: Extract<TranslateSpeechResult, { kind: 'speech' }>,
      voice: string | null,
      gender: VoiceGender,
      retry: boolean,
      issue: ClipIssue | 'no_voice' | null,
    ) => {
      const bytes = Buffer.from(r.ttsAudio, 'base64')
      logClip({
        sessionId,
        utteranceId,
        lang,
        voice: voice ?? 'none',
        gender,
        retry,
        format: r.audioFormat ?? 'wav',
        bytes: bytes.length,
        stats: analyseWav(bytes),
        issue,
      })
    }
    if (!breaker.allow()) return { lang, listeners, kind: 'failed', reason: 'circuit_open', ms: 0 }
    try {
      const request = (gender: VoiceGender) => {
        const voice = findVoice(normalizeLocale(lang), gender)
        return {
          voice,
          input: {
            audio: audioBase64,
            srcLang: sourceLang(spokenLang),
            tgtLang: toApiLang(lang),
            // No voice for this language: still translate (captions) with a placeholder, drop its audio.
            azureVoice: voice ?? getVoiceName(normalizeLocale(lang), gender),
            sessionId,
            speakerId,
          },
        }
      }
      const first = request(voiceGender)
      let result = await translateWithRetry(translate, first.input)
      breaker.success()
      if (result.kind === 'silence') return { lang, listeners, kind: 'silence', ms: ms() }

      let issue: ClipIssue | 'no_voice' | null = first.voice ? audioProblem(result) : 'no_voice'
      logClipOf(result, first.voice, voiceGender, false, issue)
      const second = request(otherGender(voiceGender))
      if (issue && issue !== 'no_voice' && second.voice && second.voice !== first.voice) {
        const usedGender = otherGender(voiceGender)
        // Empty or inaudible clip: one more try with the other gender's voice for this language.
        try {
          const again = await translateWithRetry(translate, second.input)
          if (again.kind === 'speech') {
            const againIssue = audioProblem(again)
            logClipOf(again, second.voice, usedGender, true, againIssue)
            if (!againIssue) {
              result = again
              issue = null
            }
          }
        } catch {
          // the retry is best effort: the caption we already have is still delivered
        }
      }
      return {
        lang,
        listeners,
        ...result,
        ttsAudio: issue ? '' : result.ttsAudio,
        ...(issue ? { audioIssue: issue } : {}),
        ms: ms(),
      }
    } catch (error) {
      breaker.failure()
      const timeout = error instanceof TransVoiceApiError && /timeout|aborted/i.test(error.message)
      return {
        lang,
        listeners,
        kind: 'failed',
        reason: timeout ? 'timeout' : 'error',
        ...(error instanceof TransVoiceApiError
          ? { status: error.status, detail: error.message.slice(0, 120) }
          : { detail: error instanceof Error ? error.message.slice(0, 120) : 'unknown' }),
        ms: ms(),
      }
    }
  }

  const entries = [...groups.entries()]
  const settled = await Promise.allSettled(
    entries.map(async ([lang, listeners]) => {
      const result = await translateOne(lang, listeners)
      try {
        await onResult?.(result)
      } catch (error) {
        console.error(
          'Translation delivery failed:',
          error instanceof Error ? error.message : error,
        )
      }
      return result
    }),
  )
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { lang: entries[i]![0], listeners: entries[i]![1], kind: 'failed', reason: 'error', ms: 0 },
  )
}
