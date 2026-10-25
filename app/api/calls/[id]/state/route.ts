import { NextResponse } from 'next/server'
import { callContext } from '@/lib/meetings/calls'
import type { RoomState } from '@/lib/meetings/room-state'

/**
 * GET /api/calls/[id]/state — the session's state straight from the database, for participants.
 * The room normally follows LiveKit room metadata; this is the safety net for a metadata update
 * that never arrived (LiveKit hiccup during Start, a stale write), polled while the room still
 * says "ready".
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const { data: session } = await admin
    .from('call_sessions')
    .select('meeting_id, host_id, status, started_at, end_reason')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: 'No such session.' }, { status: 404 })
  const { data: rights } = await admin.rpc('call_rights', {
    p_meeting: session.meeting_id,
    p_user: user.id,
  })
  if (!rights) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })

  const closed = session.status !== 'ready' && session.status !== 'live'
  const state: RoomState = {
    status: closed ? 'ended' : session.status === 'live' ? 'live' : 'ready',
    startedAt: session.started_at,
    hostId: session.host_id,
    endReason: closed ? (session.end_reason ?? undefined) : undefined,
  }
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
