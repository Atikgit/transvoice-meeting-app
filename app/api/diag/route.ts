import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/supabase/server'

const body = z.object({
  type: z.enum([
    'local_audio_muted',
    'local_audio_unmuted',
    'local_audio_ended',
    'audio_blocked',
    'duck_restored',
    'realtime_status',
  ]),
  detail: z.string().max(60).optional(),
  sessionId: z.uuid().optional(),
})

/**
 * POST /api/diag — a browser reports audio trouble it can see and the server cannot (microphone
 * track muted/ended, audio blocked, a lowered voice restored, Realtime channel status). One log
 * line: {"event":"client",…}; no user id, text or audio. Signed-in users, rate-limited.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('latency', user.id))) return new NextResponse(null, { status: 429 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid report.' }, { status: 400 })
  console.info(JSON.stringify({ event: 'client', ...parsed.data }))
  return new NextResponse(null, { status: 204 })
}
