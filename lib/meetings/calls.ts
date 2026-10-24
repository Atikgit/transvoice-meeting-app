import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { publishRoomState } from '@/lib/livekit/rooms'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const CALL_ERRORS: Record<string, { status: number; error: string }> = {
  NO_SESSION: { status: 404, error: 'This meeting session does not exist.' },
  NOT_HOST: { status: 403, error: 'Only the host can do that.' },
  NO_MINUTES: { status: 402, error: 'You have no minutes left. Get minutes to start the call.' },
  SESSION_CLOSED: { status: 409, error: 'This meeting session has ended.' },
}

export function callError(message: string | undefined) {
  const code = Object.keys(CALL_ERRORS).find((key) => message?.includes(key))
  if (!code) console.error('Call control failed:', message)
  const { status, error } = code ? CALL_ERRORS[code]! : { status: 500, error: 'Please try again.' }
  return NextResponse.json({ error, code }, { status })
}

/** Signed-in user and a valid session id from the route, or an error response. */
export async function callContext(params: Promise<{ id: string }>) {
  const user = await getSessionUser()
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }),
    }
  }
  const id = z.uuid().safeParse((await params).id)
  if (!id.success)
    return { response: NextResponse.json({ error: 'Invalid session.' }, { status: 400 }) }
  return { ok: true as const, user, sessionId: id.data, admin: createAdminClient() }
}

/** Database first, then LiveKit; a LiveKit failure is reported but the database stays the truth. */
export async function publishOrWarn(...args: Parameters<typeof publishRoomState>) {
  try {
    await publishRoomState(...args)
    return true
  } catch (error) {
    console.error(
      'LiveKit room metadata update failed:',
      error instanceof Error ? error.message : error,
    )
    return false
  }
}
