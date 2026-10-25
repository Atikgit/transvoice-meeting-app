import 'server-only'
import { NextResponse } from 'next/server'
import { callContext } from '@/lib/meetings/calls'
import { notifyUser } from '@/lib/realtime/notify'
import type { AnswerOutcome } from '@/lib/supabase/database.types'

/** Accept or decline as the callee; tells the caller on their user channel. */
export async function answer(params: Promise<{ id: string }>, accept: boolean) {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const { data, error } = await admin.rpc('answer_call', {
    p_session: sessionId,
    p_user: user.id,
    p_accept: accept,
  })
  const result = data?.[0]
  if (error || !result) {
    if (error?.message.includes('NOT_ALLOWED')) {
      return NextResponse.json({ error: 'This call is not for you.' }, { status: 403 })
    }
    console.error('answer_call failed:', error?.message)
    return NextResponse.json({ error: 'Please try again.' }, { status: 500 })
  }
  if (result.outcome === 'expired' || result.outcome === 'closed') {
    return NextResponse.json(
      { outcome: result.outcome, error: 'This call is no longer ringing.' },
      { status: 410 },
    )
  }

  const { data: session } = await admin
    .from('call_sessions')
    .select('initiated_by')
    .eq('id', sessionId)
    .maybeSingle()
  if (session) {
    await notifyUser(session.initiated_by, {
      event: 'call_answered',
      payload: {
        sessionId,
        meetingId: result.meeting_id,
        outcome: result.outcome as AnswerOutcome,
      },
    })
  }
  return NextResponse.json({
    outcome: result.outcome,
    redirect: result.outcome === 'accepted' ? `/m/${result.meeting_id}/lobby` : undefined,
  })
}
