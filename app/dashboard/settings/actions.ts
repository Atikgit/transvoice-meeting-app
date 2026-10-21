'use server'

import { revalidatePath } from 'next/cache'
import { profileUpdateSchema } from '@/lib/profile/schema'
import { createClient } from '@/lib/supabase/server'

export interface SettingsFormState {
  error?: string
  saved?: boolean
}

export async function updateProfile(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const parsed = profileUpdateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Your session has expired. Please sign in again.' }

  // Runs as the user: RLS limits it to their own row and column grants to these fields.
  const { error } = await supabase.from('profiles').update(parsed.data).eq('id', user.id)
  if (error) return { error: 'Could not save your settings. Please try again.' }

  revalidatePath('/dashboard', 'layout')
  return { saved: true }
}
