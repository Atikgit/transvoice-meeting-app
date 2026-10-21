import { describe, expect, it } from 'vitest'
import { profileUpdateSchema } from '@/lib/profile/schema'

const valid = {
  full_name: '  Atik  ',
  headline: '',
  linkedin_url: 'https://www.linkedin.com/in/atik',
  spoken_lang: 'bn-BD',
  listen_lang: 'en-US',
  voice_gender: 'male',
  original_audio_mode: 'duck',
}

describe('profileUpdateSchema', () => {
  it('trims and turns empty optionals into null', () => {
    expect(profileUpdateSchema.parse(valid)).toEqual({
      ...valid,
      full_name: 'Atik',
      headline: null,
    })
    expect(profileUpdateSchema.parse({ ...valid, linkedin_url: '' }).linkedin_url).toBeNull()
  })

  it.each([
    ['full_name', ''],
    ['linkedin_url', 'https://evil.com/in/atik'],
    ['linkedin_url', 'http://linkedin.com/in/atik'],
    ['spoken_lang', 'xx-XX'],
    ['voice_gender', 'robot'],
    ['original_audio_mode', 'loud'],
    ['headline', 'x'.repeat(161)],
  ])('rejects invalid %s', (field, value) => {
    expect(profileUpdateSchema.safeParse({ ...valid, [field]: value }).success).toBe(false)
  })

  it('ignores fields users may not edit', () => {
    const parsed = profileUpdateSchema.parse({ ...valid, id: 'other', avatar_url: 'x' })
    expect(parsed).not.toHaveProperty('id')
    expect(parsed).not.toHaveProperty('avatar_url')
  })
})
