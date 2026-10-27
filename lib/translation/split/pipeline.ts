import { findVoice, otherGender, type VoiceGender } from '@/lib/transvoice/voices'
import { normalizeLocale } from '@/lib/transvoice/languages'
import {
  streamTranslation as realStream,
  synthesize as realSynthesize,
  transcribe as realTranscribe,
  type SplitConfig,
} from '@/lib/transvoice/split-client'
import { isHallucination } from '@/lib/translation/split/hallucination'
import { SentenceSplitter } from '@/lib/translation/split/sentences'

/** A clip shorter than this is an error body or an empty answer, not speech. */
const MIN_MP3_BYTES = 1000
/** Held back from the first tokens so a "Silence" answer is dropped before anything is shown. */
export const SILENCE_HOLD_CHARS = 8
/** How long a ready clip waits to learn whether it is the last one. */
export const LAST_GRACE_MS = 150

export interface SplitTimings {
  sttMs: number
  translateFirstTokenMs?: number
  firstSentenceMs?: number
  ttsFirstByteMs?: number
  /** Request start → first clip handed to LiveKit / the cache. */
  toFirstAudioMs?: number
}

export type SplitLanguageResult =
  | {
      lang: string
      listeners: string[]
      kind: 'speech'
      sentences: number
      clips: number
      /** Some sentences have a caption but no audio. */
      audioMissing: boolean
      voiceFallback: boolean
      timings: SplitTimings
    }
  | { lang: string; listeners: string[]; kind: 'silence' }
  /** Nothing was delivered for this language: the caller runs the single-call path for it. */
  | { lang: string; listeners: string[]; kind: 'fallback'; step: string }

export interface SplitDeps {
  config: SplitConfig
  transcribe?: typeof realTranscribe
  streamTranslation?: typeof realStream
  synthesize?: typeof realSynthesize
  /** Caption as soon as a sentence is complete; `translated` is everything so far. */
  deliverCaption: (
    lang: string,
    listeners: string[],
    caption: { original: string; translated: string; seq: number },
  ) => Promise<unknown>
  deliverClip: (
    lang: string,
    listeners: string[],
    clip: { seq: number; last: boolean; audio: Uint8Array },
  ) => Promise<unknown>
  log?: (event: Record<string, unknown>) => void
  now?: () => number
}

/** Wakes waiters when the sentence list or the end flag changes. */
class Signal {
  private waiters: (() => void)[] = []
  notify() {
    const w = this.waiters
    this.waiters = []
    for (const resolve of w) resolve()
  }
  async until(condition: () => boolean) {
    while (!condition()) await new Promise<void>((resolve) => this.waiters.push(resolve))
  }
}

/**
 * The split pipeline for one utterance: speech-to-text ONCE, then for every listener language in
 * parallel: streamed translation -> sentence by sentence caption + text-to-speech, clips delivered
 * in order with {seq, last}. Never throws: a step that fails before anything was delivered for a
 * language becomes `fallback` for that language (or for all of them when the speech-to-text fails).
 */
export async function runSplitPipeline({
  audioBase64,
  ext,
  spokenSrcLang,
  voiceGender,
  groups,
  startedAt,
  deps,
}: {
  audioBase64: string
  ext: 'wav' | 'ogg' | 'webm'
  /** Whisper code of the speaker's language, or "auto". */
  spokenSrcLang: string
  voiceGender: VoiceGender
  groups: Map<string, string[]>
  /** performance.now() when the request started (for toFirstAudioMs). */
  startedAt: number
  deps: SplitDeps
}): Promise<{ sttMs: number; sttFailed: boolean; languages: SplitLanguageResult[] }> {
  const now = deps.now ?? (() => performance.now())
  const log = deps.log ?? (() => {})
  const entries = [...groups.entries()]
  const all = (make: (lang: string, listeners: string[]) => SplitLanguageResult) =>
    entries.map(([lang, listeners]) => make(lang, listeners))

  const sttStarted = now()
  let original: string
  try {
    const stt = await (deps.transcribe ?? realTranscribe)(
      deps.config,
      audioBase64,
      ext,
      spokenSrcLang,
    )
    original = stt.text.trim()
  } catch (error) {
    log({ step: 'stt', failed: true, detail: error instanceof Error ? error.message : 'error' })
    return {
      sttMs: Math.round(now() - sttStarted),
      sttFailed: true,
      languages: all((lang, listeners) => ({ lang, listeners, kind: 'fallback', step: 'stt' })),
    }
  }
  const sttMs = Math.round(now() - sttStarted)
  if (isHallucination(original)) {
    return {
      sttMs,
      sttFailed: false,
      languages: all((lang, listeners) => ({ lang, listeners, kind: 'silence' })),
    }
  }

  const translateOne = async (lang: string, listeners: string[]): Promise<SplitLanguageResult> => {
    const locale = normalizeLocale(lang)
    const preferred = findVoice(locale, voiceGender)
    const alternate = findVoice(locale, otherGender(voiceGender))
    let voice = preferred
    let voiceFallback = false

    const translateStarted = now()
    const sentences: {
      text: string
      tts: Promise<{ audio: Uint8Array; firstByteMs: number } | null>
    }[] = []
    const signal = new Signal()
    let ended = false
    let cumulative = ''
    let captionChain: Promise<unknown> = Promise.resolve()
    const timings: SplitTimings = { sttMs }
    let delivered = 0
    let missing = false

    const synth = async (text: string) => {
      if (!voice) return null
      for (const candidate of [voice, alternate && alternate !== voice ? alternate : null]) {
        if (!candidate) continue
        try {
          const clip = await (deps.synthesize ?? realSynthesize)(deps.config, text, candidate)
          if (clip.audio.length >= MIN_MP3_BYTES) {
            if (candidate !== voice) {
              // the first-choice voice gave nothing: use the other gender from now on
              voice = candidate
              voiceFallback = true
              log({ event: 'voice_fallback', lang, voice: candidate })
            }
            return clip
          }
          log({ step: 'tts', lang, voice: candidate, empty: true, bytes: clip.audio.length })
        } catch (error) {
          log({
            step: 'tts',
            lang,
            voice: candidate,
            failed: true,
            detail: error instanceof Error ? error.message : 'error',
          })
        }
      }
      return null
    }

    const addSentence = (text: string) => {
      const seq = sentences.length
      sentences.push({ text, tts: synth(text) })
      cumulative = cumulative ? `${cumulative} ${text}` : text
      if (seq === 0) timings.firstSentenceMs = Math.round(now() - translateStarted)
      const caption = { original, translated: cumulative, seq }
      captionChain = captionChain
        .then(() => deps.deliverCaption(lang, listeners, caption))
        .catch(() => {})
      signal.notify()
    }

    // Delivers clips in order; `last` goes on a clip only once the stream has ended after it.
    const deliverer = (async () => {
      for (let k = 0; ; k++) {
        await signal.until(() => sentences.length > k || ended)
        const sentence = sentences[k]
        if (!sentence) return
        const clip = await sentence.tts
        // `last` is only known once the stream has ended. Wait a moment for it, but never hold the
        // sound back for the rest of the translation: the listener also lets go of the original
        // voice a short while after a clip that was not marked last.
        await Promise.race([
          signal.until(() => ended || sentences.length > k + 1),
          new Promise((resolve) => setTimeout(resolve, LAST_GRACE_MS)),
        ])
        if (!clip) {
          missing = true
          continue
        }
        if (k === 0) timings.ttsFirstByteMs = clip.firstByteMs
        const last = ended && k === sentences.length - 1
        try {
          await deps.deliverClip(lang, listeners, { seq: k, last, audio: clip.audio })
          delivered++
          timings.toFirstAudioMs ??= Math.round(now() - startedAt)
        } catch (error) {
          log({
            step: 'deliver',
            lang,
            failed: true,
            detail: error instanceof Error ? error.message : 'error',
          })
        }
      }
    })()

    let held = ''
    let released = false
    const splitter = new SentenceSplitter()
    const release = (text: string) => {
      released = true
      for (const s of splitter.push(text)) addSentence(s)
    }
    try {
      for await (const chunk of (deps.streamTranslation ?? realStream)(
        deps.config,
        original,
        locale,
      )) {
        timings.translateFirstTokenMs ??= Math.round(now() - translateStarted)
        if (released) {
          for (const s of splitter.push(chunk)) addSentence(s)
          continue
        }
        held += chunk
        // "Silence" is only known to be a real answer once it is longer than the word or ends.
        if (held.length >= SILENCE_HOLD_CHARS && !/^\W*silence/i.test(held)) release(held)
      }
      if (!released) {
        const answer = held.trim().replace(/[\s.!?।。]+$/u, '')
        if (answer === '' || answer.toLowerCase() === 'silence') {
          ended = true
          signal.notify()
          await deliverer
          return { lang, listeners, kind: 'silence' }
        }
        release(held)
      }
      for (const s of splitter.flush()) addSentence(s)
    } catch (error) {
      log({
        step: 'translate',
        lang,
        failed: true,
        detail: error instanceof Error ? error.message : 'error',
      })
      // Nothing shown yet: the single path takes over for this language.
      if (sentences.length === 0) {
        ended = true
        signal.notify()
        await deliverer
        return { lang, listeners, kind: 'fallback', step: 'translate' }
      }
      for (const s of splitter.flush()) addSentence(s)
      missing = true
    }
    ended = true
    signal.notify()
    await Promise.all([deliverer, captionChain])
    if (delivered === 0 && !voice) missing = true
    // The first sentence's speech failed outright: the single path can still deliver audio.
    if (delivered === 0 && sentences.length > 0 && voice) {
      return { lang, listeners, kind: 'fallback', step: 'tts' }
    }
    return {
      lang,
      listeners,
      kind: 'speech',
      sentences: sentences.length,
      clips: delivered,
      audioMissing: missing,
      voiceFallback,
      timings,
    }
  }

  const languages = await Promise.all(
    entries.map(([lang, listeners]) => translateOne(lang, listeners)),
  )
  return { sttMs, sttFailed: false, languages }
}
