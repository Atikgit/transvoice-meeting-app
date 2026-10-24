import { NextResponse, type NextRequest } from 'next/server'
import { WebhookReceiver } from 'livekit-server-sdk'
import { serverEnv } from '@/lib/env'
import { scheduleGraceCheck } from '@/lib/livekit/grace'
import { sessionIdFromRoom } from '@/lib/livekit/server'
import { createAdminClient } from '@/lib/supabase/admin'

const HANDLED = new Set(['participant_joined', 'participant_left', 'room_finished'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/livekit/webhook — set in LiveKit Cloud → Settings → Webhooks:
 * https://meet.transvoice.ai/api/livekit/webhook (signed with the project's API key).
 * participant_joined / participant_left / room_finished open and close participant_segments
 * (payer per Rule 2) for Phase 3 metering; a leave starts the reconnect grace check (Rule 5).
 */
export async function POST(request: NextRequest) {
  const env = serverEnv()
  const body = await request.text()
  let event
  try {
    event = await new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).receive(
      body,
      request.headers.get('authorization') ?? undefined,
    )
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  const sessionId = sessionIdFromRoom(event.room?.name)
  if (!HANDLED.has(event.event) || !sessionId) return NextResponse.json({ result: 'ignored' })
  if (!event.id) return NextResponse.json({ error: 'Event id missing.' }, { status: 400 })

  const identity = event.participant?.identity
  const userId = identity && UUID.test(identity) ? identity : null
  const at = new Date(Number(event.createdAt ?? 0) * 1000 || Date.now()).toISOString()

  const { data, error } = await createAdminClient().rpc('record_livekit_event', {
    p_event_id: event.id,
    p_event: event.event,
    p_session: sessionId,
    p_user: userId,
    p_at: at,
  })
  if (error) {
    console.error('record_livekit_event failed:', error.message)
    // 5xx: LiveKit retries; the event id keeps the retry idempotent.
    return NextResponse.json({ error: 'Could not record the event.' }, { status: 500 })
  }

  if (event.event === 'participant_left' && data === 'ok') scheduleGraceCheck(sessionId)
  return NextResponse.json({ result: data })
}
