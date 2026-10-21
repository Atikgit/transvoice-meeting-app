import { z } from 'zod'
import { isSupportedLanguage } from '@/lib/transvoice/languages'

const language = z.string().refine(isSupportedLanguage, 'Choose a language from the list.')
const emptyToNull = (value: string) => (value === '' ? null : value)

/** Editable profile fields (matches the column grants in the RLS migration). */
export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(1, 'Enter your name.').max(120),
  headline: z
    .string()
    .trim()
    .max(160, 'Keep the headline under 160 characters.')
    .transform(emptyToNull),
  linkedin_url: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/\S+$/.test(value),
      'Use a full LinkedIn URL, e.g. https://www.linkedin.com/in/your-name',
    )
    .transform(emptyToNull),
  spoken_lang: language,
  listen_lang: language,
  voice_gender: z.enum(['male', 'female']),
  original_audio_mode: z.enum(['off', 'duck', 'mute']),
})

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>
