import { NextResponse, type NextRequest } from 'next/server'
import { DRAIN_RETRY_MS, isDraining } from '@/lib/draining'
import { serverEnv } from '@/lib/env'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadTranslationContext } from '@/lib/translation/context'
import { deliverResult } from '@/lib/translation/deliver'
import { translationGate } from '@/lib/translation/gate'
import { translateForListeners } from '@/lib/translation/fanout'
import { planFanout } from '@/lib/translation/plan'
import { logDecision, logTranslate } from '@/lib/translation/log'
import { parseTranslateUpload } from '@/lib/translation/request'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * POST /api/translate (multipart: audio WAV ≤ 2 MB, sessionId, utteranceId, clientTs).
 * The caller must be a connected participant of that live session. 30 requests/min/user.
 * No billing here: the Phase 3 minute meter bills connected time.
 */
export async function POST(request: NextRequest) {
  // Shutting down (SIGTERM): requests already running finish, new ones are told to retry.
  if (isDraining()) {
    return NextResponse.json(
      { code: 'DRAINING', error: 'The server is restarting. Retrying…', retryable: true },
      { status: 503, headers: { 'Retry-After': String(DRAIN_RETRY_MS / 1000) } },
    )
  }
  const startedAt = performance.now()
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('translate', user.id))) {
    return NextResponse.json({ error: 'Too many utterances. Slow down a little.' }, { status: 429 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  const upload = await parseTranslateUpload(form)
  if ('error' in upload)
    return NextResponse.json({ error: upload.error }, { status: upload.status })

  const contextStartedAt = performance.now()
  const loaded = await loadTranslationContext(upload.sessionId, user.id)
  const contextMs = Math.round(performance.now() - contextStartedAt)
  if (!loaded.ok) {
    logDecision({
      sessionId: upload.sessionId,
      utteranceId: upload.utteranceId,
      decision: `rejected:${loaded.code}`,
    })
    return NextResponse.json({ code: loaded.code, error: loaded.error }, { status: loaded.status })
  }

  const { context } = loaded
  const gate = translationGate({
    hostEmail: context.hostEmail,
    payerHasMinutes: context.speaker.payerHasMinutes,
    speakerIsPayer: context.speaker.payerId === user.id,
    allowlist: serverEnv().TRANSLATION_BETA_ALLOWLIST,
    enabled: serverEnv().TRANSLATION_ENABLED,
  })
  const plan = planFanout(context.speaker.spokenLang, context.participants)
  const decisionLog = {
    sessionId: upload.sessionId,
    utteranceId: upload.utteranceId,
    speakerLang: context.speaker.spokenLang,
    listenerLangs: context.participants.map((p) => p.listenLang),
    targets: [...plan.groups.keys()],
  }
  if (!gate.ok) {
    logDecision({ ...decisionLog, decision: `blocked:${gate.code}` })
    return NextResponse.json(
      {
        code: gate.code,
        error: gate.error,
        // Lets the room offer "Subscribe" to the payer and "Message host" to everyone else.
        payerIsSpeaker: context.speaker.payerId === user.id,
      },
      { status: gate.status },
    )
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
  const results = await translateForListeners({
    audioBase64: Buffer.from(upload.audio).toString('base64'),
    spokenLang: context.speaker.spokenLang,
    voiceGender: context.speaker.voiceGender,
    groups,
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
      return {
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
  })
}
