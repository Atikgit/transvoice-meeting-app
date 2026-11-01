import 'server-only'
import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { loadTranslationContext } from '@/lib/translation/context'
import {
  deliverResult,
  deliverSentenceCaption,
  deliverSentenceClip,
} from '@/lib/translation/deliver'
import { translationGate } from '@/lib/translation/gate'
import { sourceLang, translateForListeners, type LanguageResult } from '@/lib/translation/fanout'
import { splitBreaker } from '@/lib/translation/breaker'
import { runSplitPipeline, type SplitLanguageResult } from '@/lib/translation/split/pipeline'
import { splitStats } from '@/lib/translation/split/stats'
import { splitConfig, translatorKind } from '@/lib/transvoice/split-client'
import { planFanout } from '@/lib/translation/plan'
import { logDecision, logTranslate } from '@/lib/translation/log'
import type { TranslateUpload } from '@/lib/translation/request'

/** What admission loaded: the stored session state of the speaker's meeting. */
export type Admitted = Extract<Awaited<ReturnType<typeof loadTranslationContext>>, { ok: true }>
export type Admission = { ok: true; admitted: Admitted; contextMs: number }

/**
 * The checks every utterance passes before any speech is processed (used by POST /api/translate
 * and, on the first chunk, by POST /api/translate/chunk): the speaker is a connected participant
 * of a live session, and the translation gate (beta allow-list, kill switch, payer minutes) is open.
 */
export async function admitUtterance({
  user,
  sessionId,
  utteranceId,
}: {
  user: { id: string }
  sessionId: string
  utteranceId: string
}): Promise<
  { ok: true; admitted: Admitted; contextMs: number } | { ok: false; response: NextResponse }
> {
  const contextStartedAt = performance.now()
  const loaded = await loadTranslationContext(sessionId, user.id)
  const contextMs = Math.round(performance.now() - contextStartedAt)
  if (!loaded.ok) {
    logDecision({ sessionId, utteranceId, decision: `rejected:${loaded.code}` })
    return {
      ok: false,
      response: NextResponse.json(
        { code: loaded.code, error: loaded.error },
        { status: loaded.status },
      ),
    }
  }
  const { context } = loaded
  const gate = translationGate({
    hostEmail: context.hostEmail,
    payerHasMinutes: context.speaker.payerHasMinutes,
    speakerIsPayer: context.speaker.payerId === user.id,
    allowlist: serverEnv().TRANSLATION_BETA_ALLOWLIST,
    enabled: serverEnv().TRANSLATION_ENABLED,
  })
  if (!gate.ok) {
    const plan = planFanout(context.speaker.spokenLang, context.participants)
    logDecision({
      sessionId,
      utteranceId,
      speakerLang: context.speaker.spokenLang,
      listenerLangs: context.participants.map((p) => p.listenLang),
      targets: [...plan.groups.keys()],
      decision: `blocked:${gate.code}`,
    })
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: gate.code,
          error: gate.error,
          // Lets the room offer "Subscribe" to the payer and "Message host" to everyone else.
          payerIsSpeaker: context.speaker.payerId === user.id,
        },
        { status: gate.status },
      ),
    }
  }
  return { ok: true, admitted: loaded, contextMs }
}

/**
 * Translates one admitted utterance for every listener language and answers the speaker (the body
 * of POST /api/translate, shared with the chunked upload). `admitted` skips the second context
 * load when the caller already admitted the speaker.
 */
export async function translateUtterance({
  user,
  upload,
  startedAt,
  admitted,
}: {
  user: { id: string }
  upload: TranslateUpload
  startedAt: number
  admitted?: Admission
}): Promise<NextResponse> {
  const contextStartedAt = performance.now()
  const admission =
    admitted ??
    (await admitUtterance({ user, sessionId: upload.sessionId, utteranceId: upload.utteranceId }))
  if (!admission.ok) return admission.response
  const contextMs = admission.contextMs
  const { context } = admission.admitted
  const plan = planFanout(context.speaker.spokenLang, context.participants)
  const decisionLog = {
    sessionId: upload.sessionId,
    utteranceId: upload.utteranceId,
    speakerLang: context.speaker.spokenLang,
    listenerLangs: context.participants.map((p) => p.listenLang),
    targets: [...plan.groups.keys()],
  }
  const groups = plan.groups
  // Same-language listeners only: nothing to translate (original audio at full volume).
  if (groups.size === 0) {
    logDecision({ ...decisionLog, decision: plan.reason })
    return NextResponse.json({
      utteranceId: upload.utteranceId,
      languages: [],
      // Tells the speaker why nothing happened: same language (fixable) or nobody else here.
      reason: plan.reason,
    })
  }
  logDecision({ ...decisionLog, decision: 'translate' })

  const delivered = new Map<string, { captionMs: number; audioMs: number } | null>()

  // Split pipeline (TRANSLATION_PIPELINE=split): speech-to-text once, then per language streamed
  // translation → per-sentence speech. Whatever it cannot do runs through the single call below.
  const cfg = splitConfig()
  const useSplit =
    serverEnv().TRANSLATION_PIPELINE === 'split' &&
    translatorKind(cfg) !== null &&
    splitBreaker.allow()
  let split: Awaited<ReturnType<typeof runSplitPipeline>> | undefined
  let singleGroups = groups
  let splitOriginal: string | null = null
  if (useSplit) {
    const clipVia = new Map<string, number>()
    split = await runSplitPipeline({
      audioBase64: Buffer.from(upload.audio).toString('base64'),
      ext: upload.format === 'wav' ? 'wav' : upload.audio[0] === 0x4f ? 'ogg' : 'webm',
      spokenSrcLang: sourceLang(context.speaker.spokenLang),
      voiceGender: context.speaker.voiceGender,
      groups,
      startedAt,
      deps: {
        config: cfg,
        deliverCaption: (lang, listeners, caption) => {
          splitOriginal ??= caption.original
          return deliverSentenceCaption({
            sessionId: upload.sessionId,
            utteranceId: upload.utteranceId,
            speakerId: user.id,
            speechEndedAt: upload.clientTs,
            lang,
            listeners,
            original: caption.original,
            translated: caption.translated,
          })
        },
        deliverClip: async (lang, listeners, clip) => {
          await deliverSentenceClip({
            sessionId: upload.sessionId,
            utteranceId: upload.utteranceId,
            speakerId: user.id,
            speechEndedAt: upload.clientTs,
            lang,
            listeners,
            ...clip,
          })
          clipVia.set(lang, (clipVia.get(lang) ?? 0) + 1)
        },
        log: (event) => console.warn(JSON.stringify({ event: 'split_step', ...event })),
      },
    })
    const fallbackLangs = split.languages.filter((l) => l.kind === 'fallback')
    if (fallbackLangs.length > 0) {
      splitStats.failures += 1
      splitBreaker.failure()
      singleGroups = new Map(fallbackLangs.map((l) => [l.lang, groups.get(l.lang) ?? []]))
    } else {
      splitBreaker.success()
      singleGroups = new Map()
    }
  }

  const singleResults: LanguageResult[] =
    singleGroups.size === 0
      ? []
      : await translateForListeners({
          audioBase64: Buffer.from(upload.audio).toString('base64'),
          spokenLang: context.speaker.spokenLang,
          voiceGender: context.speaker.voiceGender,
          groups: singleGroups,
          sessionId: upload.sessionId,
          speakerId: user.id,
          utteranceId: upload.utteranceId,
          onResult: async (result) => {
            delivered.set(
              result.lang,
              await deliverResult({
                sessionId: upload.sessionId,
                utteranceId: upload.utteranceId,
                speakerId: user.id,
                speechEndedAt: upload.clientTs,
                result,
              }),
            )
          },
        })
  const splitDone = (split?.languages ?? []).filter(
    (l): l is Exclude<SplitLanguageResult, { kind: 'fallback' }> => l.kind !== 'fallback',
  )
  // One list for the log and the answer: single-call results plus the split ones.
  const results: LanguageResult[] = [
    ...splitDone.map((l): LanguageResult =>
      l.kind === 'silence'
        ? { lang: l.lang, listeners: l.listeners, kind: 'silence', ms: 0 }
        : {
            lang: l.lang,
            listeners: l.listeners,
            kind: 'speech',
            originalText: splitOriginal ?? '',
            translatedText: '',
            ttsAudio: '',
            ms: l.timings.toFirstAudioMs ?? 0,
          },
    ),
    ...singleResults,
  ]
  logTranslate({
    sessionId: upload.sessionId,
    utteranceId: upload.utteranceId,
    audioBytes: upload.audio.length,
    audioFormat: upload.format,
    ...(upload.seq !== undefined ? { seq: upload.seq } : {}),
    intakeMs: Math.round(contextStartedAt - startedAt),
    contextMs,
    languages: results.map((r) => {
      const d = delivered.get(r.lang)
      const sp = splitDone.find((l) => l.lang === r.lang)
      const fb = split?.languages.find((l) => l.lang === r.lang && l.kind === 'fallback')
      const speech = sp?.kind === 'speech' ? sp : undefined
      return {
        pipeline: sp ? ('split' as const) : ('single' as const),
        fallback: fb && fb.kind === 'fallback' ? fb.step : undefined,
        sttMs: sp ? split?.sttMs : undefined,
        translateFirstTokenMs: speech?.timings.translateFirstTokenMs,
        firstSentenceMs: speech?.timings.firstSentenceMs,
        ttsFirstByteMs: speech?.timings.ttsFirstByteMs,
        sentences: speech?.sentences,
        toFirstAudioMs: speech
          ? speech.timings.toFirstAudioMs
          : d && d.audioMs >= 0
            ? Math.round(contextStartedAt - startedAt) + contextMs + r.ms + d.audioMs
            : undefined,
        lang: r.lang,
        pair: `${context.speaker.spokenLang}>${r.lang}`,
        outcome: r.kind,
        reason: r.kind === 'failed' ? r.reason : undefined,
        status: r.kind === 'failed' ? r.status : undefined,
        detail: r.kind === 'failed' ? r.detail : undefined,
        apiMs: r.ms,
        asrMs: r.kind === 'speech' ? r.timings?.asrMs : undefined,
        mtMs: r.kind === 'speech' ? r.timings?.mtMs : undefined,
        ttsMs: r.kind === 'speech' ? r.timings?.ttsMs : undefined,
        captionMs: d?.captionMs,
        // deliverResult reports -1 when there was no audio to send.
        audioMs: d && d.audioMs >= 0 ? d.audioMs : undefined,
      }
    }),
    totalMs: Math.round(performance.now() - startedAt),
    ...(useSplit ? { splitFailures: splitStats.failures } : {}),
  })
  const speech = results.find((r) => r.kind === 'speech')
  const failed = results.filter((r) => r.kind === 'failed')

  return NextResponse.json({
    utteranceId: upload.utteranceId,
    // The speaker sees their own original transcript.
    original: speech?.kind === 'speech' ? speech.originalText : null,
    silence: results.every((r) => r.kind === 'silence'),
    languages: results.map((r) => ({
      lang: r.lang,
      result: r.kind === 'failed' ? r.reason : r.kind,
    })),
    unavailable: failed.length === results.length,
    // 401/403 from the API: our key is wrong or revoked, which no retry will fix.
    serviceKeyRejected: failed.some((f) => f.status === 401 || f.status === 403),
    // 402 from the Speech API: the account is out of credit; every call fails until it is topped up.
    serviceNoBalance: failed.some((f) => f.status === 402),
  })
}
