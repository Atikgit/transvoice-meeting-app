import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { roomNameFor, roomService } from '@/lib/livekit/server'
import { callContext } from '@/lib/meetings/calls'
import { isSpokenLanguage, isSupportedLanguage, normalizeLocale } from '@/lib/transvoice/languages'

const body = z
  .object({
    // "bn", "bn_BD" and "bn-BD" are accepted and stored in one spelling ("bn-BD").
    spokenLang: z
      .string()
      .transform(normalizeLocale)
      .refine(isSpokenLanguage, 'Choose a spoken language from the list.')
      .optional(),
    listenLang: z
      .string()
      .transform(normalizeLocale)
      .refine(isSupportedLanguage, 'Choose a language from the list.')
      .optional(),
  })
  .refine((v) => v.spokenLang || v.listenLang, 'Nothing to change.')

/**
 * POST /api/calls/[id]/languages — change my spoken and/or listen language for this session
 * from the room's Live translation menu. Updates meeting_participants (read by every
 * utterance, so it applies from the next one) and my LiveKit participant metadata (set by the
 * server: tokens cannot update their own). The profile is not changed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await callContext(params)
  if (!context.ok) return context.response
  const { user, sessionId, admin } = context

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    )
  }

  const { data, error } = await admin.rpc('set_participant_langs', {
    p_session: sessionId,
    p_user: user.id,
    p_spoken: parsed.data.spokenLang,
    p_listen: parsed.data.listenLang,
  })
  const row = data?.[0]
  if (error || !row) {
    if (error?.message.includes('NOT_A_PARTICIPANT')) {
      return NextResponse.json({ error: 'You are not in this meeting.' }, { status: 403 })
    }
    if (error?.message.includes('SESSION_CLOSED')) {
      return NextResponse.json({ error: 'This meeting has ended.' }, { status: 409 })
    }
    console.error('set_participant_langs failed:', error?.message)
    return NextResponse.json({ error: 'Please try again.' }, { status: 500 })
  }

  let metadataUpdated = true
  try {
    await roomService().updateParticipant(
      roomNameFor(sessionId),
      user.id,
      JSON.stringify({
        name: row.display_name,
        spokenLang: row.spoken_lang,
        listenLang: row.listen_lang,
        role: row.role,
      }),
    )
  } catch (e) {
    // Not connected right now: the database already has the change.
    metadataUpdated = false
    console.warn('LiveKit participant metadata update skipped:', e instanceof Error ? e.message : e)
  }
  return NextResponse.json({
    spokenLang: row.spoken_lang,
    listenLang: row.listen_lang,
    metadataUpdated,
  })
}
