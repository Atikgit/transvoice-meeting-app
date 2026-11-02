import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const body = z.object({ sessionId: z.uuid() })

/**
 * POST /api/heartbeat { sessionId } — the room page, every 20 s while its LiveKit connection is
 * up. Moves the caller's open participant segment's last_heartbeat_at forward; the minute meter
 * stops billing a tab 45 s after its last heartbeat (crash, sleep, network loss), see
 * record_heartbeat. Only ever touches the caller's own segment. Nothing personal is logged.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('heartbeat', user.id))) return new NextResponse(null, { status: 429 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })

  const { data, error } = await createAdminClient().rpc('record_heartbeat', {
    p_session: parsed.data.sessionId,
    p_user: user.id,
  })
  if (error) return NextResponse.json({ error: 'Heartbeat failed.' }, { status: 503 })
  if (data === 'reconnected') console.info(JSON.stringify({ event: 'heartbeat', result: data }))
  return NextResponse.json({ result: data })
}
