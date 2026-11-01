import { describe, expect, it, vi } from 'vitest'
import {
  CHUNK_IDLE_MS,
  CHUNK_TTL_MS,
  ChunkStore,
  MAX_OPEN_PER_USER,
  MAX_UTTERANCE_BYTES,
} from '@/lib/translation/chunks'
import { isWav, pcm16ToWav, wavSeconds } from '@/lib/translation/wav'

const pcm = (n: number, value: number) => new Uint8Array(n).fill(value)
const meta = () => ({ admitted: true })

function store() {
  let now = 1_000
  const idle = vi.fn()
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
  const setTimer = ((fn: () => void, ms: number) => {
    const t = { fn, ms, cleared: false }
    timers.push(t)
    return t
  }) as unknown as typeof setTimeout
  const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation((t) => {
    if (t && typeof t === 'object') (t as unknown as { cleared: boolean }).cleared = true
  })
  const s = new ChunkStore<{ admitted: boolean }>(idle, () => now, setTimer)
  return {
    s,
    idle,
    timers,
    advance: (ms: number) => (now += ms),
    fire: () =>
      timers
        .filter((t) => !t.cleared)
        .at(-1)!
        .fn(),
    done: () => clear.mockRestore(),
  }
}

describe('ChunkStore', () => {
  it('assembles chunks that arrive out of order, in sequence order, when the last one is complete', () => {
    const t = store()
    const add = (seq: number, value: number, last = false) =>
      t.s.add('u1', 'x', { seq, data: pcm(4, value), last }, meta)
    expect(add(2, 3, true)).toEqual({ kind: 'stored', duplicate: false }) // the last chunk comes first
    expect(add(0, 1)).toEqual({ kind: 'stored', duplicate: false })
    const done = add(1, 2)
    expect(done.kind).toBe('complete')
    if (done.kind === 'complete') {
      expect([...done.pcm]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
      expect(done.meta).toEqual({ admitted: true })
    }
    expect(t.s.has('u1', 'x')).toBe(false) // closed
    t.done()
  })

  it('tolerates a duplicate chunk (a retry) and rejects a different chunk under the same number', () => {
    const t = store()
    t.s.add('u1', 'x', { seq: 0, data: pcm(4, 1), last: false }, meta)
    expect(t.s.add('u1', 'x', { seq: 0, data: pcm(4, 1), last: false }, meta)).toEqual({
      kind: 'stored',
      duplicate: true,
    })
    expect(t.s.add('u1', 'x', { seq: 0, data: pcm(6, 9), last: false }, meta)).toEqual({
      kind: 'rejected',
      reason: 'conflict',
    })
    expect(t.s.has('u1', 'x')).toBe(false) // a confused client's utterance is dropped
    t.done()
  })

  it('a duplicate of the LAST chunk does not assemble twice; a finished utterance is remembered', () => {
    const t = store()
    t.s.add('u1', 'x', { seq: 0, data: pcm(2, 1), last: false }, meta)
    expect(t.s.add('u1', 'x', { seq: 1, data: pcm(2, 2), last: true }, meta).kind).toBe('complete')
    expect(t.s.wasFinished('u1', 'x')).toBe(true)
    expect(t.s.add('u1', 'x', { seq: 1, data: pcm(2, 2), last: true }, meta)).toEqual({
      kind: 'rejected',
      reason: 'finished',
    })
    t.done()
  })

  it('a missing chunk never assembles (the browser falls back to the whole upload)', () => {
    const t = store()
    t.s.add('u1', 'x', { seq: 0, data: pcm(2, 1), last: false }, meta)
    expect(t.s.add('u1', 'x', { seq: 2, data: pcm(2, 3), last: true }, meta).kind).toBe('stored')
    t.advance(CHUNK_TTL_MS + 1)
    expect(t.s.has('u1', 'x')).toBe(false) // expired after 20 s
    t.done()
  })

  it('limits: 12 s of audio per utterance, 2 open utterances per user, 20 s lifetime', () => {
    const t = store()
    t.s.add('u1', 'a', { seq: 0, data: pcm(100, 1), last: false }, meta)
    t.s.add('u1', 'b', { seq: 0, data: pcm(100, 1), last: false }, meta)
    expect(MAX_OPEN_PER_USER).toBe(2)
    expect(t.s.add('u1', 'c', { seq: 0, data: pcm(100, 1), last: false }, meta)).toEqual({
      kind: 'rejected',
      reason: 'too_many_open',
    })
    // another user is not affected
    expect(t.s.add('u2', 'c', { seq: 0, data: pcm(100, 1), last: false }, meta).kind).toBe('stored')

    expect(MAX_UTTERANCE_BYTES).toBe(12 * 32_000)
    const long = store()
    let seq = 0
    let result = long.s.add('u1', 'x', { seq: seq++, data: pcm(32_000, 1), last: false }, meta)
    while (result.kind === 'stored' && seq < 13)
      result = long.s.add('u1', 'x', { seq: seq++, data: pcm(32_000, 1), last: false }, meta)
    expect(result).toEqual({ kind: 'rejected', reason: 'too_long' })
    t.done()
    long.done()
  })

  it('validates the chunk itself (odd length, negative or huge seq, oversize)', () => {
    const t = store()
    for (const data of [
      { seq: 0, data: pcm(3, 1), last: false },
      { seq: -1, data: pcm(2, 1), last: false },
      { seq: 9999, data: pcm(2, 1), last: false },
    ])
      expect(t.s.add('u1', 'x', data, meta)).toEqual({ kind: 'rejected', reason: 'bad_chunk' })
    expect(t.s.add('u1', 'x', { seq: 0, data: pcm(70_000, 1), last: false }, meta)).toEqual({
      kind: 'rejected',
      reason: 'too_large',
    })
    t.done()
  })

  it('without a last chunk, 3 s of silence assembles what arrived — if nothing in between is missing', () => {
    const t = store()
    t.s.add('u1', 'x', { seq: 0, data: pcm(4, 1), last: false }, meta)
    t.s.add('u1', 'x', { seq: 1, data: pcm(4, 2), last: false }, meta)
    expect(t.timers.at(-1)!.ms).toBe(CHUNK_IDLE_MS)
    t.fire()
    expect(t.idle).toHaveBeenCalledTimes(1)
    expect([...t.idle.mock.calls[0]![0]]).toEqual([1, 1, 1, 1, 2, 2, 2, 2])

    const gap = store()
    gap.s.add('u1', 'y', { seq: 0, data: pcm(4, 1), last: false }, meta)
    gap.s.add('u1', 'y', { seq: 2, data: pcm(4, 3), last: false }, meta) // 1 never came
    gap.fire()
    expect(gap.idle).not.toHaveBeenCalled() // a lost chunk: dropped, so the whole-upload fallback is not ignored
    expect(gap.s.has('u1', 'y')).toBe(false)
    expect(gap.s.wasFinished('u1', 'y')).toBe(false)
    t.done()
    gap.done()
  })

  it('discard() forgets a partial utterance', () => {
    const t = store()
    t.s.add('u1', 'x', { seq: 0, data: pcm(4, 1), last: false }, meta)
    t.s.discard('u1', 'x')
    expect(t.s.has('u1', 'x')).toBe(false)
    expect(t.s.wasFinished('u1', 'x')).toBe(false)
    t.done()
  })
})

describe('pcm16ToWav', () => {
  it('wraps PCM in a valid 16 kHz mono WAV of the same length', () => {
    const wav = pcm16ToWav(new Uint8Array(32_000))
    expect(isWav(wav)).toBe(true)
    expect(wavSeconds(wav.length)).toBe(1)
    const view = new DataView(wav.buffer)
    expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([
      1, 16_000, 16,
    ])
  })
})
