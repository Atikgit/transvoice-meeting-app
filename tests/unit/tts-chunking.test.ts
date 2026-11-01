import { describe, expect, it } from 'vitest'
import { LATENCY_SENTENCES } from '../fixtures/latency-sentences'
import { MAX_INLINE_PACKET_BYTES, inlinePacketSize } from '@/lib/translation/messages'
import {
  MAX_SENTENCE_CHARS,
  MIN_CLAUSE_CHARS,
  SentenceSplitter,
} from '@/lib/translation/split/sentences'

const split = (text: string) => {
  const s = new SentenceSplitter()
  return [...s.push(text), ...s.flush()]
}

/** Worst case from the field report: a 120-character Bangla sentence made a 13.4 KB clip. */
const WORST_BYTES_PER_CHAR = Math.ceil(13_400 / 120)
const HEADER = {
  type: 'tvx.audio.inline' as const,
  v: 2,
  build: 'abcdef',
  utteranceId: 'u'.repeat(36),
  speakerId: 'u'.repeat(36),
  format: 'mp3' as const,
  speechEndedAt: 1_700_000_000_000,
}
const packetFor = (chars: number) =>
  inlinePacketSize({ ...HEADER, lang: 'bn', seq: 9, last: false }, chars * WORST_BYTES_PER_CHAR)

describe('TTS chunking for inline delivery', () => {
  it('cuts every piece at about 2 s of speech (<= 65 characters)', () => {
    for (const { text } of LATENCY_SENTENCES) {
      for (const piece of split(text)) expect(piece.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
    }
  })

  it('prefers a clause mark (, ; : ، ) over a mid-phrase space when it must cut', () => {
    const long =
      'Before we start, let me share the agenda: first the budget, then the hiring plan, and more'
    const pieces = split(long)
    expect(pieces[0]).toBe('Before we start, let me share the agenda: first the budget,')
    expect(pieces.every((p) => p.length <= MAX_SENTENCE_CHARS)).toBe(true)
    expect(pieces[0]!.length).toBeGreaterThanOrEqual(MIN_CLAUSE_CHARS)
  })

  it('splits at the Bangla danda and double danda', () => {
    expect(split('প্রথম বাক্য। দ্বিতীয় বাক্য॥ তৃতীয়')).toEqual([
      'প্রথম বাক্য।',
      'দ্বিতীয় বাক্য॥',
      'তৃতীয়',
    ])
  })

  it('cuts text without spaces at the limit, not inside a surrogate pair', () => {
    const pieces = split('😀'.repeat(80))
    expect(pieces.join('')).toBe('😀'.repeat(80))
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
  })

  it('does not cut a decimal number at a clause mark', () => {
    const text = `${'word '.repeat(12)}1,5 more words after the number go on and on until the end`
    expect(split(text).join(' ')).toContain('1,5')
  })

  it('inline size math: before 120-character pieces (12 KiB cap) vs after 65 (14 KiB cap)', () => {
    const before = packetFor(120)
    const after = packetFor(MAX_SENTENCE_CHARS)
    // before: a worst-case Bangla piece was over the old 12 KiB cap -> fetched by URL (506-605 ms)
    expect(before).toBeGreaterThan(12 * 1024)
    // after: the same worst case is far under the cap -> inline (5-9 ms)
    expect(after).toBeLessThan(MAX_INLINE_PACKET_BYTES)
    expect(MAX_INLINE_PACKET_BYTES).toBeLessThan(15 * 1024)
    console.log(
      `inline packet, worst-case Bangla: before ${before} B (cap 12288) -> after ${after} B (cap ${MAX_INLINE_PACKET_BYTES})`,
    )
  })
})

describe('first-clause TTS', () => {
  const streamed = (text: string, eagerFirst: boolean) => {
    const s = new SentenceSplitter({ eagerFirst })
    const out: { piece: string; atChars: number }[] = []
    let fed = 0
    for (const word of text.split(/(?<= )/)) {
      fed += word.length
      for (const piece of s.push(word)) out.push({ piece, atChars: fed })
    }
    for (const piece of s.flush()) out.push({ piece, atChars: fed })
    return out
  }

  it('cuts the first piece at the first clause mark once 25 characters are there', () => {
    const text = 'Good morning everyone, thank you for joining us today, we will start now.'
    const [first] = streamed(text, true)
    expect(first!.piece).toBe('Good morning everyone, thank you for joining us today,')
    expect(first!.piece.length).toBeGreaterThanOrEqual(MIN_CLAUSE_CHARS)
  })

  it('a clause mark before 25 characters does not cut', () => {
    const [first] = streamed('Yes, we can do that, and more besides, right now.', true)
    expect(first!.piece.length).toBeGreaterThanOrEqual(MIN_CLAUSE_CHARS)
  })

  it('only the first piece is eager; the rest keep their order and the full text', () => {
    const text = 'Good morning everyone, thank you for joining us today, we will start now.'
    const pieces = streamed(text, true).map((p) => p.piece)
    expect(pieces.join(' ')).toBe(text)
  })

  it('speech can start earlier: with eagerFirst the first piece is ready sooner (before/after, in characters streamed)', () => {
    const text =
      'Before we begin the meeting today, I would like to share the agenda with everyone here.'
    const eager = streamed(text, true)[0]!
    const lazy = streamed(text, false)[0]!
    console.log(
      `first piece ready after ${lazy.atChars} streamed characters -> ${eager.atChars} with first-clause TTS`,
    )
    expect(eager.atChars).toBeLessThan(lazy.atChars)
  })
})
