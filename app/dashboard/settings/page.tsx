import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CallSoundsSetting } from '@/components/calls/enable-call-sounds'
import { SettingsForm } from '@/components/settings/settings-form'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/settings')

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'full_name, headline, linkedin_url, spoken_lang, listen_lang, voice_gender, original_audio_mode',
    )
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">Settings</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Your profile</h1>
      <p className="mt-2 text-sm text-slate-500">
        Signed in as {user.email}
        {user.email_confirmed_at ? ' · verified' : ' · not verified yet'}
      </p>

      <div className="mt-8 rounded-3xl border border-white/10 bg-[#151b29] p-6 sm:p-8">
        {profile ? (
          <SettingsForm profile={profile} />
        ) : (
          <p className="text-sm text-slate-400">
            Your profile is still being set up. Refresh in a moment.
          </p>
        )}
      </div>
      <CallSoundsSetting />
    </div>
  )
}
