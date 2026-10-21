import { describe, expect, it } from 'vitest'
import { isSupportedLanguage, languageOptions, toApiLang } from '@/lib/transvoice/languages'
import { getVoiceName, voiceMapping } from '@/lib/transvoice/voices'

describe('languages', () => {
  it('has unique locale codes', () => {
    const codes = languageOptions.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('converts locales to API language codes', () => {
    expect(toApiLang('bn-BD')).toBe('bn')
    expect(toApiLang('fil-PH')).toBe('fil')
    expect(toApiLang('en')).toBe('en')
  })

  it('recognises supported languages', () => {
    expect(isSupportedLanguage('bn-BD')).toBe(true)
    expect(isSupportedLanguage('xx-XX')).toBe(false)
  })
})

describe('voices', () => {
  it('picks the mapped voice by gender', () => {
    expect(getVoiceName('bn-BD', 'male')).toBe('bn-BD-PradeepNeural')
    expect(getVoiceName('bn-BD')).toBe('bn-BD-NabanitaNeural')
  })

  it('falls back to English voices for unmapped locales', () => {
    expect(getVoiceName('zu-ZA')).toBe('en-US-AvaNeural')
    expect(getVoiceName('zu-ZA', 'male')).toBe('en-US-AndrewNeural')
  })

  it('only maps voices for listed languages', () => {
    for (const code of Object.keys(voiceMapping)) expect(isSupportedLanguage(code)).toBe(true)
  })
})
