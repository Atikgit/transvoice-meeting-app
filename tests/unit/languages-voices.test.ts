import { describe, expect, it } from 'vitest'
import {
  isSpokenLanguage,
  isSupportedLanguage,
  LANGUAGE_COUNT_LABEL,
  LANGUAGES_AND_VOICES,
  languageOptions,
  spokenLanguageOptions,
  toApiLang,
} from '@/lib/transvoice/languages'
import { findVoice, getVoiceName, otherGender, voiceMapping } from '@/lib/transvoice/voices'

// Same pattern as the profiles.spoken_lang / listen_lang checks (migration 20261022000600).
const DB_LANG_FORMAT = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?(-[a-z]{4,8})?$/

describe('languages', () => {
  it('offers at least 140 listen languages, matching the "140+" copy', () => {
    expect(LANGUAGE_COUNT_LABEL).toBe('140+')
    expect(LANGUAGES_AND_VOICES).toBe('140+ languages & voices')
    expect(languageOptions.length).toBeGreaterThanOrEqual(140)
  })

  it('offers only Whisper-recognizable languages as spoken languages', () => {
    expect(spokenLanguageOptions.length).toBeGreaterThan(100)
    expect(spokenLanguageOptions.length).toBeLessThan(languageOptions.length)
    expect(spokenLanguageOptions.every((l) => l.whisper)).toBe(true)
    expect(isSpokenLanguage('bn-BD')).toBe(true)
    expect(languageOptions.find((l) => l.code === 'fil-PH')?.whisper).toBe('tl')
    expect(languageOptions.find((l) => l.code === 'nb-NO')?.whisper).toBe('no')
    for (const listenOnly of ['zu-ZA', 'ga-IE', 'iu-Cans-CA', 'zh-CN-sichuan']) {
      expect(isSupportedLanguage(listenOnly)).toBe(true)
      expect(isSpokenLanguage(listenOnly)).toBe(false)
    }
  })

  it('has unique locale codes that the database accepts', () => {
    const codes = languageOptions.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(DB_LANG_FORMAT)
  })

  it('is sorted by label', () => {
    const labels = languageOptions.map((l) => l.label.toLowerCase())
    expect(labels).toEqual([...labels].sort())
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

  it('falls back to English voices for unmapped English locales', () => {
    expect(getVoiceName('xx-XX')).toBe('en-US-AvaNeural')
    expect(getVoiceName('xx-XX', 'male')).toBe('en-US-AndrewNeural')
  })

  it('finds a voice by language, and never gives a non-English language an English one', () => {
    expect(findVoice('bn', 'male')).toBe('bn-BD-PradeepNeural')
    expect(findVoice('bn-IN', 'female')).toBe('bn-IN-TanishaaNeural')
    expect(findVoice('xx-XX')).toBeNull()
    expect(otherGender('male')).toBe('female')
  })

  it('has a native voice of each gender for every listed language', () => {
    expect(Object.keys(voiceMapping).sort()).toEqual(languageOptions.map((l) => l.code).sort())
    for (const [code, voice] of Object.entries(voiceMapping)) {
      expect(voice.male.startsWith(`${code}-`)).toBe(true)
      expect(voice.female.startsWith(`${code}-`)).toBe(true)
      expect(voice.female).toMatch(/Neural$/)
    }
  })
})
