import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { notifyUser } from '@/lib/realtime/notify'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const body = z.object({ meetingId: z.uuid() })

/**
 * POST /api/calls { meetingId } — "Call" (Rule 3). The host goes straight to the lobby; a
 * sponsored guest rings the sponsor (incoming-call modal, 30 s); an expired guest with minutes
 * calls as host of a new meeting; an expired guest with 0 minutes gets 402 (Subscribe/Message).
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'meetingId is required.' }, { status: 400 })
  if (!(await checkRateLimit('call', user.id))) {
    return NextResponse.json({ error: 'Too many calls. Please wait a minute.' }, { status: 429 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('create_call', {
    p_meeting: parsed.data.meetingId,
    p_caller: user.id,
  })
  const call = data?.[0]
  if (error || !call) {
    if (error?.message.includes('NO_MINUTES')) {
      return NextResponse.json(
        {
          code: 'NO_MINUTES',
          error: 'Your sponsored time has ended and you have no minutes left.',
          options: ['subscribe', 'message'],
        },
        { status: 402 },
      )
    }
    if (error?.message.includes('NOT_ALLOWED')) {
      return NextResponse.json(
        { code: 'NOT_ALLOWED', error: 'You cannot call this meeting.' },
        { status: 403 },
      )
    }
    console.error('create_call failed:', error?.message)
    return NextResponse.json({ error: 'Could not start the call.' }, { status: 500 })
  }

  if (call.mode !== 'ringing') {
    return NextResponse.json({ mode: call.mode, redirect: `/m/${call.meeting_id}/lobby` })
  }

  const { data: caller } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle()
  await notifyUser(call.callee_id!, {
    event: 'incoming_call',
    payload: {
      sessionId: call.session_id!,
      meetingId: call.meeting_id,
      callerName: caller?.full_name || 'Your partner',
      expiresAt: call.expires_at!,
      fromHost: call.callee_id !== null && user.id === (await hostOf(admin, call.meeting_id)),
    },
  })
  console.info(JSON.stringify({ event: 'call', action: 'ringing', sessionId: call.session_id }))
  return NextResponse.json({
    mode: 'ringing',
    sessionId: call.session_id,
    meetingId: call.meeting_id,
    expiresAt: call.expires_at,
  })
}

async function hostOf(admin: ReturnType<typeof createAdminClient>, meetingId: string) {
  const { data } = await admin.from('meetings').select('owner_id').eq('id', meetingId).maybeSingle()
  return data?.owner_id
}
