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
  // Someone re-entering a session they are already in (left, changed languages in the lobby,
  // came back): the stored session row would otherwise keep the old languages.
  await syncSessionLanguages(meetingId, user.id, profile)
  const media = new URLSearchParams({ camera, mic })
  redirect(`/m/${meetingId}?${media}`)
}

/** Applies the lobby's languages to the user's row in the meeting's open session, if they have one. */
async function syncSessionLanguages(
  meetingId: string,
  userId: string,
  languages: { spoken_lang: string; listen_lang: string },
) {
  const admin = createAdminClient()
  const { data: open } = await admin
    .from('call_sessions')
    .select('id')
    .eq('meeting_id', meetingId)
    .in('status', ['ready', 'live'])
    .maybeSingle()
  if (!open) return
  // NOT_A_PARTICIPANT (first visit): the row is created from the profile when the token is issued.
  const { error } = await admin.rpc('set_participant_langs', {
    p_session: open.id,
    p_user: userId,
    p_spoken: languages.spoken_lang,
    p_listen: languages.listen_lang,
  })
  if (error && !error.message.includes('NOT_A_PARTICIPANT')) {
    console.error('Syncing lobby languages failed:', error.message)
  }
}
