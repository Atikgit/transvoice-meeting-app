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
