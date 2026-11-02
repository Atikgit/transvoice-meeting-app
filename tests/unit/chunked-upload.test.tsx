// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChunkStreamer,
  CHUNK_MS,
  floatToPcm16,
  type StreamEvent,
} from '@/features/translation/chunk-stream'
import { ChunkUpload, type Poster } from '@/features/translation/chunk-upload'
import { FRAME_MS, FRAME_SAMPLES } from '@/features/translation/utterance-chunker'

const frame = (v = 0.5) => new Float32Array(FRAME_SAMPLES).fill(v)
const frames = (ms: number) => Math.round(ms / FRAME_MS)

// --- the streamer: what the browser cuts the speech into -------------------------------------
function streamer(maxPieceMs = 6000) {
  const events: StreamEvent[] = []
  let n = 0
  const s = new ChunkStreamer(maxPieceMs, (e) => events.push(e), { newId: () => `id${++n}` })
  const feed = (kind: 'speech' | 'pause', ms: number, v = 0.5) => {
    for (let i = 0; i < frames(ms); i++)
      s.frame(kind === 'speech' ? 0.9 : 0.05, frame(kind === 'speech' ? v : 0))
  }
  return {
    s,
    events,
    feed,
    chunks: () =>
      events.filter((e) => e.type === 'chunk') as Extract<StreamEvent, { type: 'chunk' }>[],
  }
}

describe('ChunkStreamer', () => {
  it('sends ~500 ms chunks WHILE speaking; at the end only the last one (≤ 0.5 s) is left', () => {
    const t = streamer()
    t.feed('pause', 100) // pre-speech frames
    t.s.speechStart()
    t.feed('speech', 2200)
    const before = t.chunks()
    expect(before.length).toBeGreaterThanOrEqual(4) // already uploading, nobody has stopped talking
    expect(before.every((c) => !c.last)).toBe(true)
    expect(before.map((c) => c.seq)).toEqual(before.map((_, i) => i))
    expect(before[0]!.pcm.length).toBe(Math.round(CHUNK_MS / FRAME_MS) * FRAME_SAMPLES * 2)
    t.feed('pause', 400)
    t.s.speechEnd(400)
    const all = t.chunks()
    const last = all.at(-1)!
    expect(last.last).toBe(true)
    expect(last.pcm.length).toBeLessThanOrEqual(Math.round(CHUNK_MS / FRAME_MS) * FRAME_SAMPLES * 2)
    // one utterance id for all of them, then the piece for the fallback
    expect(new Set(all.map((c) => c.utteranceId)).size).toBe(1)
    const piece = t.events.find((e) => e.type === 'piece')!
    expect(piece).toMatchObject({ type: 'piece', utteranceId: all[0]!.utteranceId, pieceSeq: 0 })
  })

  it('the chunks add up to the speech (PCM16, nothing lost or repeated)', () => {
    const t = streamer()
    t.s.speechStart()
    t.feed('speech', 1700, 0.25)
    t.s.speechEnd(0)
    const bytes = t.chunks().reduce((n, c) => n + c.pcm.length, 0)
    expect(bytes).toBe(frames(1700) * FRAME_SAMPLES * 2)
    const sample = new DataView(t.chunks()[0]!.pcm.buffer).getInt16(0, true)
    expect(sample).toBe(Math.trunc(0.25 * 0x7fff)) // the same conversion as the WAV encoder
  })

  it('a speech past 6 s is cut at a pause of ≥ 250 ms that is happening NOW; pieces are separate utterances of one group, numbered', () => {
    const t = streamer(6000)
    t.s.speechStart()
    t.feed('speech', 3000)
    t.feed('pause', 200) // too short
    t.feed('speech', 3200) // 6.4 s, no usable pause yet
    expect(t.events.filter((e) => e.type === 'piece')).toHaveLength(0)
    t.feed('pause', 300) // now: cut
    let pieces = t.events.filter((e) => e.type === 'piece') as Extract<
      StreamEvent,
      { type: 'piece' }
    >[]
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ pieceSeq: 0 })
    t.feed('speech', 2000)
    t.s.speechEnd(400)
    pieces = t.events.filter((e) => e.type === 'piece') as typeof pieces
    expect(pieces.map((p) => p.pieceSeq)).toEqual([0, 1])
    expect(new Set(pieces.map((p) => p.group)).size).toBe(1)
    expect(new Set(pieces.map((p) => p.utteranceId)).size).toBe(2)
    // each utterance ends with exactly one last chunk
    for (const p of pieces)
      expect(t.chunks().filter((c) => c.utteranceId === p.utteranceId && c.last)).toHaveLength(1)
  })

  it('a noise blip that was already (partly) uploaded is aborted; a blip not yet uploaded is just dropped', () => {
    const noisy = streamer()
    noisy.s.speechStart()
    noisy.feed('speech', 700) // one chunk already out
    noisy.s.abort()
    expect(noisy.events.at(-1)).toMatchObject({
      type: 'abort',
      utteranceId: noisy.chunks()[0]!.utteranceId,
    })

    const tiny = streamer()
    tiny.s.speechStart()
    tiny.feed('speech', 100)
    tiny.feed('pause', 100)
    tiny.s.speechEnd(400) // under the minimum speech: nothing is sent at all
    expect(tiny.events).toEqual([])
  })

  it('floatToPcm16 clamps and encodes little-endian', () => {
    const pcm = floatToPcm16([Float32Array.from([0, 1, -1, 2])])
    const v = new DataView(pcm.buffer)
    expect([
      v.getInt16(0, true),
      v.getInt16(2, true),
      v.getInt16(4, true),
      v.getInt16(6, true),
    ]).toEqual([0, 32767, -32768, 32767])
  })
})

// --- the uploader: chunk failures decide the fallback ----------------------------------------
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
const chunk = (seq: number, last = false) => ({
  seq,
  pcm: new Uint8Array(4),
  last,
  group: 'g',
  pieceSeq: 0,
  clientTs: 123,
})

describe('ChunkUpload', () => {
  it('sends the contract headers; the answer to the completing chunk is handed on', async () => {
    const posts: Record<string, string>[] = []
    const post: Poster = async (headers) => {
      posts.push(headers)
      return headers['x-last'] === '1' ? json(200, { utteranceId: 'u', languages: [] }) : json(202)
    }
    const up = new ChunkUpload('u', { sessionId: 'sess' }, post)
    up.push(chunk(0))
    up.push(chunk(1, true))
    const out = await up.finish()
    expect(posts[0]).toMatchObject({
      'x-utterance-id': 'u',
      'x-session-id': 'sess',
      'x-seq': '0',
      'x-last': '0',
    })
    expect(posts[1]).toMatchObject({ 'x-seq': '1', 'x-last': '1', 'x-client-ts': '123' })
    expect(out.ok && out.response?.status).toBe(200)
  })

  it.each([
    [
      'a network error',
      async () => {
        throw new TypeError('fetch failed')
      },
    ],
    ['a server error', async () => json(500)],
    ['the server draining', async () => json(503)],
    ['a lost thread (409)', async () => json(409)],
    ['a bad chunk (400)', async () => json(400)],
  ] as [string, Poster][])(
    '%s → not ok (the whole utterance will be sent instead)',
    async (_n, post) => {
      const up = new ChunkUpload('u', { sessionId: 's' }, post)
      up.push(chunk(0))
      up.push(chunk(1, true))
      expect((await up.finish()).ok).toBe(false)
    },
  )

  it('a chunk that takes longer than the timeout fails the attempt', async () => {
    const post: Poster = (_h, _b, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      )
    const up = new ChunkUpload('u', { sessionId: 's' }, post, 40)
    up.push(chunk(0, true))
    const started = Date.now()
    expect((await up.finish()).ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it.each([401, 402, 403, 429])(
    'a %i is a decision about the speaker, handed on as the answer (no fallback)',
    async (status) => {
      const up = new ChunkUpload('u', { sessionId: 's' }, async () => json(status, { code: 'X' }))
      up.push(chunk(0, true))
      const out = await up.finish()
      expect(out.ok && out.response?.status).toBe(status)
    },
  )

  it('abort() posts x-abort', async () => {
    const post = vi.fn<Poster>(async () => new Response(null, { status: 204 }))
    new ChunkUpload('u', { sessionId: 's' }, post).abort()
    expect(post.mock.calls[0]![0]).toMatchObject({ 'x-abort': '1', 'x-utterance-id': 'u' })
  })
})

// --- the hook: chunked mode and its fallback --------------------------------------------------
const lk = { remotes: [{ identity: 'guest' }] }
vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    localParticipant: {
      getTrackPublication: () => ({
        track: {
          mediaStreamTrack: { readyState: 'live', addEventListener() {}, removeEventListener() {} },
        },
      }),
    },
    isMicrophoneEnabled: true,
  }),
  useRemoteParticipants: () => lk.remotes,
}))
type DetectorArgs = {
  streaming?: boolean
  onStream?: (e: StreamEvent) => void
  onUtterance: (u: {
    samples: Float32Array
    endedAt: number
    utteranceId?: string
    chunk?: { group: string; seq: number }
  }) => void
}
let detectorArgs: DetectorArgs
vi.mock('@/features/translation/useSpeechDetector', () => ({
  useSpeechDetector: (args: DetectorArgs) => (
    (detectorArgs = args),
    { speaking: false, error: null }
  ),
}))
vi.mock('@/features/translation/latency-beacon', () => ({ reportLatency: vi.fn() }))

const { useLiveTranslation } = await import('@/features/translation/useLiveTranslation')

describe('useLiveTranslation with uploadMode=chunked', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  /** Plays a 1.2 s utterance: three chunks while speaking, the last at the end, then the piece. */
  const speak = (id = '33333333-3333-4333-8333-333333333333') => {
    const group = '44444444-4444-4444-8444-444444444444'
    act(() => {
      for (const [seq, last] of [
        [0, false],
        [1, false],
        [2, true],
      ] as const)
        detectorArgs.onStream!({
          type: 'chunk',
          utteranceId: id,
          seq,
          pcm: new Uint8Array(8),
          last,
          group,
          pieceSeq: 0,
          endedAgoMs: 400,
        })
      detectorArgs.onUtterance({
        samples: new Float32Array(16_000),
        endedAt: performance.now() - 400,
        utteranceId: id,
        chunk: { group, seq: 0 },
      })
    })
    return id
  }
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  it('asks the detector to stream, uploads the chunks, and does NOT send the whole utterance when they got through', async () => {
    fetchMock.mockImplementation(async (url: string, init: { headers: Record<string, string> }) =>
      url === '/api/translate/chunk'
        ? init.headers['x-last'] === '1'
          ? json(200, {
              utteranceId: 'x',
              original: 'hello',
              languages: [{ lang: 'en-US', result: 'speech' }],
            })
          : json(202)
        : json(500),
    )
    const onTranscript = vi.fn()
    renderHook(() =>
      useLiveTranslation({ sessionId: 's', status: 'live', uploadMode: 'chunked', onTranscript }),
    )
    expect(detectorArgs.streaming).toBe(true)
    const id = speak()
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(id, 'hello'))
    expect(urls()).toEqual(['/api/translate/chunk', '/api/translate/chunk', '/api/translate/chunk'])
  })

  it('FALLBACK: when a chunk fails, the whole utterance goes to /api/translate under the same id', async () => {
    fetchMock.mockImplementation(
      async (url: string, init: { headers?: Record<string, string>; body?: unknown }) => {
        if (url === '/api/translate/chunk')
          return init.headers!['x-seq'] === '1' ? json(500) : json(202)
        return json(200, {
          utteranceId: 'x',
          original: 'whole',
          languages: [{ lang: 'en-US', result: 'speech' }],
        })
      },
    )
    const onTranscript = vi.fn()
    renderHook(() =>
      useLiveTranslation({ sessionId: 's', status: 'live', uploadMode: 'chunked', onTranscript }),
    )
    const id = speak()
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(id, 'whole'))
    const whole = fetchMock.mock.calls.find((c) => c[0] === '/api/translate')!
    const form = (whole[1] as { body: FormData }).body
    expect(form.get('utteranceId')).toBe(id)
    expect(form.get('group')).toBe('44444444-4444-4444-8444-444444444444')
    expect((form.get('audio') as Blob).type).toBe('audio/wav')
  })

  it('a decision from the server (no minutes) is shown, not retried as a whole upload', async () => {
    fetchMock.mockImplementation(async () =>
      json(402, {
        code: 'PAYER_NO_MINUTES',
        error: "The host's minutes have run out.",
        payerIsSpeaker: false,
      }),
    )
    const { result } = renderHook(() =>
      useLiveTranslation({ sessionId: 's', status: 'live', uploadMode: 'chunked' }),
    )
    speak()
    await waitFor(() => expect(result.current.notice?.code).toBe('PAYER_NO_MINUTES'))
    expect(urls().every((u) => u === '/api/translate/chunk')).toBe(true)
  })

  it('an aborted utterance tells the server to forget it', async () => {
    fetchMock.mockResolvedValue(json(202))
    renderHook(() => useLiveTranslation({ sessionId: 's', status: 'live', uploadMode: 'chunked' }))
    const id = '55555555-5555-4555-8555-555555555555'
    act(() => {
      detectorArgs.onStream!({
        type: 'chunk',
        utteranceId: id,
        seq: 0,
        pcm: new Uint8Array(8),
        last: false,
        group: 'g',
        pieceSeq: 0,
        endedAgoMs: 0,
      })
      detectorArgs.onStream!({ type: 'abort', utteranceId: id })
    })
    expect(fetchMock.mock.calls.at(-1)![1].headers['x-abort']).toBe('1')
  })

  it('whole mode (the default) does not stream', () => {
    renderHook(() => useLiveTranslation({ sessionId: 's', status: 'live' }))
    expect(detectorArgs.streaming).toBe(false)
  })
})
