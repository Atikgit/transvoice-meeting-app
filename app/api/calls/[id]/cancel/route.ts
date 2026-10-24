import { NextResponse } from 'next/server'
import { callContext } from '@/lib/meetings/calls'
import { notifyUser } from '@/lib/realtime/notify'

/** POST /api/calls/[id]/cancel — the caller hangs up or the 30 s ring ran out → missed. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const { data: callee, error } = await admin.rpc('cancel_call', {
    p_session: sessionId,
    p_user: user.id,
  })
  if (error) {
    console.error('cancel_call failed:', error.message)
    return NextResponse.json({ error: 'Please try again.' }, { status: 500 })
  }
  if (callee) await notifyUser(callee, { event: 'call_cancelled', payload: { sessionId } })
  return NextResponse.json({ outcome: 'missed' })
}
