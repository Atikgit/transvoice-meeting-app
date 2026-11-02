import { describe, expect, it } from 'vitest'
import { isHallucination } from '@/lib/translation/split/hallucination'
import { languageName } from '@/lib/translation/split/language-name'
import { SentenceSplitter } from '@/lib/translation/split/sentences'

/** Feeds the text in pieces of `size` characters, like tokens arriving. */
function split(text: string, size: number): string[] {
  const s = new SentenceSplitter()
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)))
  return [...out, ...s.flush()]
}

describe('isHallucination', () => {
  it.each(['', ' ', 'a', 'You', 'you.', 'Thank you', 'THANK YOU.', 'I', 'i.', 'Am I', 'am i?'])(
    'drops %j',
    (text) => expect(isHallucination(text)).toBe(true),
  )
  it.each(['Hello', 'thank you very much', 'আমি ভালো আছি', 'ok'])('keeps %j', (text) =>
    expect(isHallucination(text)).toBe(false),
  )
  it('drops null and undefined', () => {
    expect(isHallucination(null)).toBe(true)
    expect(isHallucination(undefined)).toBe(true)
  })
})

describe('SentenceSplitter', () => {
  const english = 'Good morning. How are you? I am fine! See you at 3.5 hours.'
  it.each([1, 2, 3, 7, 100])('English, chunks of %i characters', (size) => {
    expect(split(english, size)).toEqual([
      'Good morning.',
      'How are you?',
      'I am fine!',
      'See you at 3.5 hours.',
    ])
  })

  const bangla = 'শুভ সকাল। আপনি কেমন আছেন? আমি ভালো আছি! ধন্যবাদ'
  it.each([1, 2, 5, 100])('Bangla (। ? !), chunks of %i characters', (size) => {
    expect(split(bangla, size)).toEqual([
      'শুভ সকাল।',
      'আপনি কেমন আছেন?',
      'আমি ভালো আছি!',
      'ধন্যবাদ',
    ])
  })

  it('splits at line breaks', () => {
    expect(split('One\nTwo\n\nThree', 3)).toEqual(['One', 'Two', 'Three'])
  })

  it('cuts a sentence with no terminator at a space once it reaches 120 characters', () => {
    const words = Array.from({ length: 40 }, () => 'word').join(' ') // 199 chars, no terminator
    const parts = split(words, 10)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 120)).toBe(true)
    expect(parts.join(' ')).toBe(words)
  })

  it('keeps "?!", "..." and closing quotes with their sentence, and waits at the end of a chunk', () => {
    expect(split('Really?! Yes... "Fine." Ok', 1)).toEqual(['Really?!', 'Yes...', '"Fine."', 'Ok'])
    const s = new SentenceSplitter()
    expect(s.push('Total 3.')).toEqual([]) // may be a decimal point
    expect(s.push('5 units. Done')).toEqual(['Total 3.5 units.'])
    expect(s.flush()).toEqual(['Done'])
  })
})

describe('languageName', () => {
  it('uses full names', () => {
    expect(languageName('bn-BD')).toBe('Bengali')
    expect(languageName('bn')).toBe('Bengali')
    expect(languageName('en-US')).toMatch(/^English/)
    expect(languageName('es-MX')).toMatch(/^Spanish/)
  })
})
