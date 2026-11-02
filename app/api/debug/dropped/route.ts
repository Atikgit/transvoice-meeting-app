import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/supabase/server'
import { captureAllowed, captureEnabled, listDropped } from '@/lib/translation/dropped-capture'

/**
 * GET /api/debug/dropped[?sessionId=…] — the signed-in user's own dropped utterances (metadata
 * only: duration, peak / rms, STT result class, expiry), newest first. 404 while
 * DEBUG_CAPTURE_DROPPED is false; an empty list for users who are not named in
 * TRANSLATION_BETA_ALLOWLIST.
 */
export async function GET(request: Request) {
  if (!captureEnabled()) return new NextResponse(null, { status: 404 })
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await captureAllowed(user.id))) return NextResponse.json({ allowed: false, items: [] })
  const sessionId = new URL(request.url).searchParams.get('sessionId') ?? undefined
  const items = await listDropped(user.id, sessionId)
  return NextResponse.json({ allowed: true, items }, { headers: { 'Cache-Control': 'no-store' } })
}
