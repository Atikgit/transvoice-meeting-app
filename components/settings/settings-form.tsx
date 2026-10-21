'use client'

import { useActionState, type ReactNode } from 'react'
import { updateProfile, type SettingsFormState } from '@/app/dashboard/settings/actions'
import { FormMessage, inputClass } from '@/components/auth/auth-card'
import type { Profile } from '@/lib/supabase/database.types'
import { languageOptions } from '@/lib/transvoice/languages'

const selectClass =
  'w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-3 text-sm text-slate-200 outline-none focus:border-cyan-300'

const AUDIO_MODES = [
  { value: 'duck', label: 'Lower it while the translation plays' },
  { value: 'mute', label: 'Mute it (hear only the translation)' },
  { value: 'off', label: 'Keep it at full volume' },
] as const

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export type EditableProfile = Pick<
  Profile,
  | 'full_name'
  | 'headline'
  | 'linkedin_url'
  | 'spoken_lang'
  | 'listen_lang'
  | 'voice_gender'
  | 'original_audio_mode'
>

export function SettingsForm({ profile }: { profile: EditableProfile }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(updateProfile, {})

  return (
    <form action={action} className="space-y-8">
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.saved && <FormMessage tone="notice">Settings saved.</FormMessage>}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-white">Profile</h2>
        <Field label="Full name">
          <input
            required
            name="full_name"
            maxLength={120}
            autoComplete="name"
            defaultValue={profile.full_name ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="Headline" hint="Shown to people you meet, e.g. “Product designer at Acme”.">
          <input
            name="headline"
            maxLength={160}
            defaultValue={profile.headline ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="LinkedIn profile">
          <input
            name="linkedin_url"
            type="url"
            inputMode="url"
            placeholder="https://www.linkedin.com/in/your-name"
            defaultValue={profile.linkedin_url ?? ''}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-white">Languages and voice</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="I speak">
            <select name="spoken_lang" defaultValue={profile.spoken_lang} className={selectClass}>
              {languageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="I want to hear">
            <select name="listen_lang" defaultValue={profile.listen_lang} className={selectClass}>
              {languageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
            My translated voice
          </legend>
          <div className="flex gap-3">
            {(['female', 'male'] as const).map((gender) => (
              <label
                key={gender}
                className="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-slate-200 has-[:checked]:border-cyan-300/50 has-[:checked]:bg-cyan-300/10"
              >
                <input
                  type="radio"
                  name="voice_gender"
                  value={gender}
                  defaultChecked={profile.voice_gender === gender}
                  className="accent-cyan-300"
                />
                {gender === 'female' ? 'Female' : 'Male'}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="Speaker's original voice"
          hint="What you hear from the other person's own voice."
        >
          <select
            name="original_audio_mode"
            defaultValue={profile.original_audio_mode}
            className={selectClass}
          >
            {AUDIO_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
