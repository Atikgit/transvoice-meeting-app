import { AccessToken } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { getDisplayName } from '@/lib/user'

/**
 * LEGACY (not used by the current UI). Identity now comes from the session; Phase 2 replaces
 * this with GET /api/livekit/token?sessionId= and per-room authorization.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const { data: available } = await createAdminClient().rpc('has_available_minutes', {
    p_user: user.id,
  })
  if (!available) {
    return NextResponse.json(
      { error: 'Insufficient balance. Please upgrade your plan.' },
      { status: 402 },
    )
  }

  const room = req.nextUrl.searchParams.get('room') || 'quick-sync'
  const env = serverEnv()
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: user.id,
    metadata: JSON.stringify({ name: getDisplayName(user) ?? user.email ?? 'Guest' }),
  })
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true })

  return NextResponse.json({ token: await at.toJwt() })
}
