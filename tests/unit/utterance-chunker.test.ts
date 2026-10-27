import { describe, expect, it } from 'vitest'
import { FRAME_MS, FRAME_SAMPLES, UtteranceChunker } from '@/features/translation/utterance-chunker'

const frame = (value: number) => new Float32Array(FRAME_SAMPLES).fill(value)
const frames = (ms: number) => Math.round(ms / FRAME_MS)

/** Feeds `ms` of speech (probability 0.9) or pause (0.05); returns any pieces emitted. */
function feed(chunker: UtteranceChunker, kind: 'speech' | 'pause', ms: number, value = 0.5) {
  const pieces = []
  for (let i = 0; i < frames(ms); i++) {
    const piece = chunker.frame(
      kind === 'speech' ? 0.9 : 0.05,
      frame(kind === 'speech' ? value : 0),
    )
    if (piece) pieces.push(piece)
  }
  return pieces
}
const start = (c: UtteranceChunker) => c.speechStart()
const seconds = (samples: Float32Array) => samples.length / 16_000

describe('UtteranceChunker', () => {
  it('leaves a short speech to the VAD: answers whole', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    expect(feed(c, 'speech', 3000)).toEqual([])
    expect(feed(c, 'pause', 400)).toEqual([])
    expect(c.speechEnd()).toBe('whole')
  })

  it('does not cut a long speech without a pause of 250 ms', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    expect(feed(c, 'speech', 4000)).toEqual([])
    expect(feed(c, 'pause', 200)).toEqual([]) // too short a pause
    expect(feed(c, 'speech', 3000)).toEqual([]) // 7 s and still no usable pause
  })

  it('cuts at the latest pause of at least 250 ms once past the limit, in order', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    feed(c, 'speech', 2000)
    expect(feed(c, 'pause', 300)).toEqual([]) // a pause before the limit: remembered, not cut
    feed(c, 'speech', 2500) // now 4.8 s
    const pieces = feed(c, 'speech', 400) // crosses 5 s: cut at the earlier pause
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ seq: 0 })
    expect(seconds(pieces[0]!.samples)).toBeCloseTo(2.15, 1) // up to the middle of that pause
    // the rest keeps going; the next cut is the second piece
    feed(c, 'speech', 3000)
    const second = feed(c, 'pause', 300)
    expect(second.length).toBeLessThanOrEqual(1)
    const rest = c.speechEnd()
    expect(rest).not.toBe('whole')
    const all = [...pieces, ...second, ...(rest && rest !== 'whole' ? [rest] : [])]
    expect(all.map((p) => p.seq)).toEqual(all.map((_, i) => i))
  })

  it('keeps every sample of speech exactly once across the pieces', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    let total = 0
    const take = (ps: { samples: Float32Array }[]) => ps.forEach((p) => (total += p.samples.length))
    take(feed(c, 'speech', 3000, 0.4))
    take(feed(c, 'pause', 300))
    take(feed(c, 'speech', 3000, 0.4)) // cut happens here
    take(feed(c, 'pause', 100))
    const rest = c.speechEnd()
    if (rest && rest !== 'whole') total += rest.samples.length
    // the rest after the last speech frame is trimmed to a short tail, nothing of the speech is lost
    expect(seconds(new Float32Array(total))).toBeGreaterThan(6.2)
    expect(seconds(new Float32Array(total))).toBeLessThan(6.8)
  })

  it('drops a leftover too short to be speech', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    feed(c, 'speech', 5200)
    feed(c, 'pause', 300) // cut
    feed(c, 'speech', 100) // a syllable
    expect(c.speechEnd()).toBeNull()
  })

  it('forgets everything on reset (VAD misfire) and starts fresh', () => {
    const c = new UtteranceChunker(5000)
    start(c)
    feed(c, 'speech', 5200)
    feed(c, 'pause', 300)
    c.reset()
    start(c)
    expect(c.pieces).toBe(0)
    expect(feed(c, 'speech', 1000)).toEqual([])
    expect(c.speechEnd()).toBe('whole')
  })
})
