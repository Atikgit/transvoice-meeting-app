import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { createParticipantToken, roomNameFor } from '@/lib/livekit/server'
import type { MeetingRole } from '@/lib/meetings/load'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const DENIED: Record<string, { status: number; error: string }> = {
  NO_SESSION: { status: 404, error: 'This meeting session does not exist.' },
  SESSION_CLOSED: { status: 409, error: 'This meeting session has ended.' },
  NOT_ALLOWED: { status: 403, error: 'You are not invited to this meeting.' },
  NO_MINUTES: { status: 402, error: 'You have no minutes left to join this meeting.' },
}

/**
 * GET /api/livekit/token?sessionId=…
 * Signed-in users only. admit_participant() decides (Rules 1–3): the host, a guest with a valid
 * sponsored connection, or a member paying with their own minutes; it also records the payer.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const sessionId = z.uuid().safeParse(request.nextUrl.searchParams.get('sessionId'))
  if (!sessionId.success) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const { data, error } = await createAdminClient().rpc('admit_participant', {
    p_session: sessionId.data,
    p_user: user.id,
  })
  const admitted = data?.[0]
  if (error || !admitted) {
    const code = Object.keys(DENIED).find((key) => error?.message.includes(key))
    if (!code) console.error('admit_participant failed:', error?.message)
    const denied = code ? DENIED[code]! : { status: 500, error: 'Could not join the meeting.' }
    return NextResponse.json({ error: denied.error, code }, { status: denied.status })
  }

  const room = roomNameFor(sessionId.data)
  const role = admitted.role as MeetingRole
  const token = await createParticipantToken({
    identity: user.id,
    room,
    metadata: {
      name: admitted.display_name,
      spokenLang: admitted.spoken_lang,
      listenLang: admitted.listen_lang,
      role,
    },
  })

  return NextResponse.json(
    { token, url: serverEnv().NEXT_PUBLIC_LIVEKIT_URL, room, role, status: admitted.status },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
