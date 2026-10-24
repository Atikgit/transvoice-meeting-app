import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadTranslationContext } from '@/lib/translation/context'
import { deliverResult } from '@/lib/translation/deliver'
import { groupListeners, translateForListeners } from '@/lib/translation/fanout'
import { parseTranslateUpload } from '@/lib/translation/request'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * POST /api/translate (multipart: audio WAV ≤ 2 MB, sessionId, utteranceId, clientTs).
 * The caller must be a connected participant of that live session. 30 requests/min/user.
 * No billing here: the Phase 3 minute meter bills connected time.
 */
export async function POST(request: NextRequest) {
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

  const loaded = await loadTranslationContext(upload.sessionId, user.id)
  if (!loaded.ok) {
    return NextResponse.json({ code: loaded.code, error: loaded.error }, { status: loaded.status })
  }

  const { context } = loaded
  const groups = groupListeners(context.participants, context.speaker.spokenLang)
  // Same-language listeners only: nothing to translate (original audio at full volume).
  if (groups.size === 0) {
    return NextResponse.json({ utteranceId: upload.utteranceId, languages: [] })
  }

  const results = await translateForListeners({
    audioBase64: Buffer.from(upload.audio).toString('base64'),
    spokenLang: context.speaker.spokenLang,
    voiceGender: context.speaker.voiceGender,
    groups,
    sessionId: upload.sessionId,
    speakerId: user.id,
    onResult: (result) =>
      deliverResult({
        sessionId: upload.sessionId,
        utteranceId: upload.utteranceId,
        speakerId: user.id,
        speechEndedAt: upload.clientTs,
        result,
      }),
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
  })
}
