import 'server-only'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import type { OriginalAudioMode } from '@/lib/supabase/database.types'

export type MeetingRole = 'host' | 'guest'

export interface MeetingContext {
  userId: string
  email: string | undefined
  meeting: { id: string; title: string | null; roomName: string }
  role: MeetingRole
  profile: {
    fullName: string
    spokenLang: string
    listenLang: string
    originalAudioMode: 'off' | 'duck' | 'mute'
  }
}

/**
 * The meeting as the signed-in user may see it (RLS: owner, sponsored guest or participant), or
 * null when it does not exist or the user was not invited. The owner is the host.
 */
export async function loadMeetingContext(meetingId: string): Promise<MeetingContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return null
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const [{ data: meeting }, { data: profile }] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, owner_id, title, room_name')
      .eq('id', meetingId)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('full_name, spoken_lang, listen_lang, original_audio_mode')
      .eq('id', user.id)
      .maybeSingle(),
  ])
  if (!meeting) return null

  return {
    userId: user.id,
    email: user.email,
    meeting: { id: meeting.id, title: meeting.title, roomName: meeting.room_name },
    role: meeting.owner_id === user.id ? 'host' : 'guest',
    profile: {
      fullName: profile?.full_name || user.email?.split('@')[0] || '',
      spokenLang: profile?.spoken_lang ?? 'en-US',
      listenLang: profile?.listen_lang ?? 'en-US',
      originalAudioMode: (profile?.original_audio_mode ?? 'duck') as OriginalAudioMode,
    },
  }
}
