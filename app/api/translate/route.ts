import { NextResponse, type NextRequest } from 'next/server'
import { DRAIN_RETRY_MS, isDraining } from '@/lib/draining'
import { checkRateLimit } from '@/lib/rate-limit'
import { chunkStore } from '@/lib/translation/chunk-service'
import { translateUtterance } from '@/lib/translation/process'
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
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('translate', user.id))) {
    return NextResponse.json({ error: 'Too many utterances. Slow down a little.' }, { status: 429 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  const upload = await parseTranslateUpload(form)
  if ('error' in upload)
    return NextResponse.json({ error: upload.error }, { status: upload.status })

  // The whole-utterance fallback of a chunked upload: if the chunks already got through and were
  // processed, do not translate it twice; if they are still partial, they are no longer needed.
  const store = chunkStore()
  if (store.wasFinished(user.id, upload.utteranceId))
    return NextResponse.json({ utteranceId: upload.utteranceId, duplicate: true, languages: [] })
  store.discard(user.id, upload.utteranceId)
  return translateUtterance({ user, upload, startedAt })
}
