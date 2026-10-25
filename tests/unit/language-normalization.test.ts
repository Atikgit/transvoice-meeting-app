import { describe, expect, it } from 'vitest'
import { groupListeners, sourceLang } from '@/lib/translation/fanout'
import { languageKey, normalizeLocale, sameLanguage, toApiLang } from '@/lib/transvoice/languages'
import { getVoiceName } from '@/lib/transvoice/voices'

describe('normalizeLocale', () => {
  it.each([
    ['bn', 'bn-BD'],
    ['bn-BD', 'bn-BD'],
    ['bn_BD', 'bn-BD'],
    ['BN-bd', 'bn-BD'],
    ['bn_bd', 'bn-BD'],
    [' en ', 'en-US'],
    ['en', 'en-US'],
    ['en-US', 'en-US'],
    ['en_GB', 'en-GB'],
    ['es', 'es-ES'],
    ['pt', 'pt-BR'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['zh-CN-sichuan', 'zh-CN-sichuan'],
    ['fil', 'fil-PH'],
    ['yue', 'yue-CN'],
    ['xx', 'xx'], // unknown: left alone, never invented
  ])('%s → %s', (input, expected) => expect(normalizeLocale(input)).toBe(expected))
})

describe('languageKey / sameLanguage / toApiLang', () => {
  it.each([
    // [a, b, same?]
    ['bn', 'bn-BD', true],
    ['bn_BD', 'bn-IN', true], // Bangla in two countries is one language
    ['en', 'en-US', true],
    ['en-US', 'en-GB', true],
    ['EN_us', 'en-AU', true],
    ['en-US', 'bn-BD', false],
    ['es-ES', 'es-MX', true],
    ['pt-BR', 'pt-PT', true],
    ['zh-CN', 'zh-TW', false], // simplified vs traditional
    ['zh-TW', 'zh-HK', true],
    ['zh-CN', 'zh', true],
    ['yue-CN', 'zh-CN', false], // Cantonese is its own language
    ['nb-NO', 'no', false], // not guessed
  ] as const)('%s vs %s → same: %s', (a, b, same) => {
    expect(sameLanguage(a, b)).toBe(same)
    expect(sameLanguage(b, a)).toBe(same) // symmetric
  })

  it('the API always gets the bare language, whatever the spelling', () => {
    for (const input of ['bn', 'bn-BD', 'bn_BD', 'BN-bd']) expect(toApiLang(input)).toBe('bn')
    for (const input of ['en', 'en-US', 'en_us', 'en-GB']) expect(toApiLang(input)).toBe('en')
    expect(toApiLang('zh-TW')).toBe('zh')
    expect(toApiLang('yue-CN')).toBe('yue')
    expect(languageKey('zh-TW')).toBe('zh-Hant')
  })
})

describe('the same normalization drives fan-out, the API language and the voice', () => {
  it('"en", "en_us" and "en-US" listeners are one target, not three API calls', () => {
    const groups = groupListeners(
      [
        { userId: 'a', listenLang: 'en' },
        { userId: 'b', listenLang: 'en_US' },
        { userId: 'c', listenLang: 'en-US' },
        { userId: 'd', listenLang: 'bn_BD' }, // the speaker's own language: left out
      ],
      'bn-BD',
    )
    expect([...groups]).toEqual([['en-US', ['a', 'b', 'c']]])
  })

  it('a speaker stored as "bn" and a listener stored as "bn-BD" are the same language', () => {
    expect(groupListeners([{ userId: 'a', listenLang: 'bn-BD' }], 'bn').size).toBe(0)
  })

  it('src_lang comes from the Whisper table whatever the spelling; voices use the normalized locale', () => {
    expect(sourceLang('bn')).toBe('bn')
    expect(sourceLang('bn_BD')).toBe('bn')
    expect(sourceLang('fil-PH')).toBe('tl')
    expect(getVoiceName(normalizeLocale('bn_bd'), 'female')).toBe('bn-BD-NabanitaNeural')
    expect(getVoiceName(normalizeLocale('en'), 'male')).toBe('en-US-AndrewNeural')
  })
})
