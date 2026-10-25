import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

/** GET /api/calls/incoming — calls ringing for me now (covers a missed Realtime event). */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const { data, error } = await createAdminClient().rpc('incoming_calls', { p_user: user.id })
  if (error) {
    console.error('incoming_calls failed:', error.message)
    return NextResponse.json({ calls: [] })
  }
  return NextResponse.json(
    {
      calls: (data ?? []).map((c) => ({
        sessionId: c.session_id,
        meetingId: c.meeting_id,
        callerName: c.caller_name,
        expiresAt: c.expires_at,
        fromHost: c.from_host,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
