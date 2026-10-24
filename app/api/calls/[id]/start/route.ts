import { NextResponse } from 'next/server'
import { callContext, callError, publishOrWarn } from '@/lib/meetings/calls'

/** POST /api/calls/[id]/start — host only: ready → live (translation and timer start). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const { data, error } = await admin.rpc('start_call_session', {
    p_session: sessionId,
    p_user: user.id,
  })
  const row = data?.[0]
  if (error || !row) return callError(error?.message)

  const state = { status: 'live' as const, startedAt: row.started_at, hostId: user.id }
  const published = await publishOrWarn(sessionId, state)
  return NextResponse.json({ ...state, published })
}
