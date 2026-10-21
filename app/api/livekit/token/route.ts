import { AccessToken } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * LEGACY (Phase 0: behaviour preserved). Phase 2 replaces this with session-authenticated,
 * room-authorized tokens (§2.1 #4): identity = user UUID, name in metadata.
 */
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room') || 'quick-sync'
  const username = req.nextUrl.searchParams.get('username') || 'Guest'
  const userId = req.nextUrl.searchParams.get('userId')

  if (userId) {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('minutes_balance')
      .eq('id', userId)
      .single()

    if (!profile || profile.minutes_balance <= 0) {
      return NextResponse.json(
        { error: 'Insufficient balance. Please upgrade your plan.' },
        { status: 402 },
      )
    }
  }

  const env = serverEnv()
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: username })
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true })

  return NextResponse.json({ token: await at.toJwt() })
}
