import { NextResponse } from 'next/server'
import { callContext, callError, publishOrWarn } from '@/lib/meetings/calls'

/** POST /api/calls/[id]/end — host only: ends the session for everyone. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const { error } = await admin.rpc('end_call_session', {
    p_session: sessionId,
    p_user: user.id,
    p_reason: 'host_ended',
  })
  if (error) return callError(error.message)

  const state = {
    status: 'ended' as const,
    startedAt: null,
    hostId: user.id,
    endReason: 'host_ended',
  }
  const published = await publishOrWarn(sessionId, state)
  return NextResponse.json({ ...state, published })
}
