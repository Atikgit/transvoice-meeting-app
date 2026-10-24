'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { isSpokenLanguage, isSupportedLanguage } from '@/lib/transvoice/languages'

/** "Start meeting" on the dashboard: creates a meeting owned by the user, then opens its lobby. */
export async function createMeeting(): Promise<{ error: string } | void> {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/dashboard')
  if (!(await checkRateLimit('meeting', user.id))) {
    return { error: 'You have created many meetings in the last hour. Please try again later.' }
  }
  const { data: meetingId, error } = await createAdminClient().rpc('create_meeting', {
    p_user: user.id,
  })
  if (error || !meetingId) {
    console.error('create_meeting failed:', error?.message)
    return { error: 'Could not create the meeting. Please try again.' }
  }
  redirect(`/m/${meetingId}/lobby`)
}

export interface LobbyState {
  error?: string
}

const lobbySchema = z.object({
  meetingId: z.uuid(),
  full_name: z.string().trim().min(1, 'Enter your name.').max(120),
  spoken_lang: z.string().refine(isSpokenLanguage, 'Choose a spoken language from the list.'),
  listen_lang: z.string().refine(isSupportedLanguage, 'Choose a language from the list.'),
  camera: z.enum(['on', 'off']),
  mic: z.enum(['on', 'off']),
})

/** Lobby "Join": saves name and languages back to the profile, then enters the room. */
export async function joinFromLobby(_prev: LobbyState, formData: FormData): Promise<LobbyState> {
  const parsed = lobbySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  const { meetingId, camera, mic, ...profile } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/m/${meetingId}/lobby`)}`)

  const { error } = await supabase.from('profiles').update(profile).eq('id', user.id)
  if (error) {
    console.error('Saving lobby preferences failed:', error.message)
    return { error: 'Could not save your settings. Please try again.' }
  }
  const media = new URLSearchParams({ camera, mic })
  redirect(`/m/${meetingId}?${media}`)
}

export type SessionActionResult =
  | { ok: true; sessionId: string; startedAt: string }
  | { ok: false; code: 'NO_MINUTES' | 'NOT_ALLOWED' | 'NOT_LIVE' | 'FAILED'; error: string }

const SESSION_ERRORS = {
  NO_MINUTES: 'You have no minutes left. Get minutes to start the translated call.',
  NOT_ALLOWED: 'Only the host can do that.',
  NOT_LIVE: 'The meeting has not started yet.',
  FAILED: 'Something went wrong. Please try again.',
} as const

function sessionError(message: string | undefined): SessionActionResult {
  const code: keyof typeof SESSION_ERRORS = message?.includes('NO_MINUTES')
    ? 'NO_MINUTES'
    : /NOT_HOST|NOT_ALLOWED/.test(message ?? '')
      ? 'NOT_ALLOWED'
      : /NOT_LIVE|SESSION_CLOSED|NO_SESSION/.test(message ?? '')
        ? 'NOT_LIVE'
        : 'FAILED'
  if (code === 'FAILED') console.error('Call session action failed:', message)
  return { ok: false, code, error: SESSION_ERRORS[code] }
}

const id = z.uuid()

/** Host presses Start: the session goes live (translation and timer start). */
export async function startMeetingSession(meetingId: string): Promise<SessionActionResult> {
  const user = await getSessionUser()
  if (!user || !id.safeParse(meetingId).success) return sessionError('NOT_ALLOWED')
  const admin = createAdminClient()
  const { data: opened, error: openError } = await admin.rpc('open_call_session', {
    p_meeting: meetingId,
    p_user: user.id,
  })
  const sessionId = opened?.[0]?.session_id
  if (openError || !sessionId) return sessionError(openError?.message)
  const { data, error } = await admin.rpc('start_call_session', {
    p_session: sessionId,
    p_user: user.id,
  })
  const row = data?.[0]
  if (error || !row) return sessionError(error?.message)
  return { ok: true, sessionId: row.session_id, startedAt: row.started_at }
}

/** A participant enters a live session (payer resolved by the database, Rule 2/3). */
export async function joinMeetingSession(
  sessionId: string,
  startedAt: string,
): Promise<SessionActionResult> {
  const user = await getSessionUser()
  if (!user || !id.safeParse(sessionId).success) return sessionError('NOT_ALLOWED')
  const { error } = await createAdminClient().rpc('admit_participant', {
    p_session: sessionId,
    p_user: user.id,
  })
  if (error) return sessionError(error.message)
  return { ok: true, sessionId, startedAt }
}

/** Host presses End meeting. */
export async function endMeetingSession(sessionId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user || !id.safeParse(sessionId).success) return { ok: false }
  const { error } = await createAdminClient().rpc('end_call_session', {
    p_session: sessionId,
    p_user: user.id,
  })
  if (error) console.error('end_call_session failed:', error.message)
  return { ok: !error }
}
