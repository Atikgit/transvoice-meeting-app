import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryAudioCache,
  RedisAudioCache,
  isAudioId,
  newAudioId,
} from '@/lib/translation/audio-cache'
import { deliverResult } from '@/lib/translation/deliver'
import type { LanguageResult } from '@/lib/translation/fanout'
import {
  decodeInlineAudio,
  encodeInlineAudio,
  encodeMessage,
  MAX_INLINE_AUDIO_BYTES,
  MAX_PACKET_BYTES,
  TOPICS,
} from '@/lib/translation/messages'

const getSessionUser = vi.fn()
const cacheRef: { current: MemoryAudioCache } = { current: new MemoryAudioCache() }
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))
vi.mock('@/lib/translation/audio-cache', async (original) => {
  const actual = await original<typeof import('@/lib/translation/audio-cache')>()
  return { ...actual, audioCache: () => cacheRef.current }
})
const { GET: getTts } = await import('@/app/api/tts/[id]/route')

const speech = (
  lang: string,
  listeners: string[],
  overrides: Partial<LanguageResult> = {},
): LanguageResult =>
  ({
    lang,
    listeners,
    kind: 'speech',
    originalText: 'হ্যালো',
    translatedText: 'Hello',
    ttsAudio: Buffer.from('RIFF....WAVE').toString('base64'),
    ms: 700,
    ...overrides,
  }) as LanguageResult

type Sent = { data: Uint8Array; options: { destinationIdentities: string[]; topic: string } }
function recorder() {
  const sent: Sent[] = []
  const send = vi.fn(async (_session: string, data: Uint8Array, options: Sent['options']) => {
    sent.push({ data, options })
  })
  const json = (i: number) => JSON.parse(new TextDecoder().decode(sent[i]!.data))
  return { sent, send, json }
}

beforeEach(() => {
  cacheRef.current = new MemoryAudioCache()
  getSessionUser.mockReset()
})

describe('deliverResult', () => {
  it('sends the caption first, then the audio URL, only to that language’s listeners', async () => {
    const { sent, send, json } = recorder()
    await deliverResult({
      sessionId: 's1',
      utteranceId: 'u1',
      speakerId: 'speaker',
      speechEndedAt: 1_761_300_000_000,
      result: speech('en-US', ['en-1', 'en-2']),
      send,
      cache: cacheRef.current,
    })
    expect(sent.map((s) => s.options)).toEqual([
      { destinationIdentities: ['en-1', 'en-2'], topic: TOPICS.caption },
      { destinationIdentities: ['en-1', 'en-2'], topic: TOPICS.audio },
    ])
    expect(json(0)).toEqual({
      utteranceId: 'u1',
      speakerId: 'speaker',
      lang: 'en-US',
      original: 'হ্যালো',
      translated: 'Hello',
      speechEndedAt: 1_761_300_000_000,
    })
    const audio = json(1)
    expect(audio).toMatchObject({
      utteranceId: 'u1',
      lang: 'en-US',
      url: expect.stringMatching(/^\/api\/tts\/[A-Za-z0-9_-]{24}$/),
    })
    const cached = await cacheRef.current.get(audio.url.split('/').pop())
    expect(cached?.recipients).toEqual(['en-1', 'en-2'])
  })

  it('sends the caption and the audio at the same moment, not one after the other', async () => {
    const releases: (() => void)[] = []
    const send = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)), // a slow LiveKit API
    )
    const done = deliverResult({
      sessionId: 's1',
      utteranceId: 'u1',
      speakerId: 'speaker',
      speechEndedAt: 1,
      result: speech('en-US', ['en-1']),
      send,
      cache: cacheRef.current,
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2)) // both in flight, none finished
    expect(send.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      expect.objectContaining({ topic: TOPICS.caption }),
      expect.objectContaining({ topic: TOPICS.audio }),
    ])
    releases.forEach((release) => release())
    expect(await done).toMatchObject({ captionMs: expect.any(Number), audioMs: expect.any(Number) })
  })

  describe('compressed clips (the API reports a format)', () => {
    const small = Buffer.alloc(4000, 7)
    it('a clip of at most 12 KiB travels inside the packet: no cache entry, no URL', async () => {
      const { sent, send } = recorder()
      const put = vi.spyOn(cacheRef.current, 'put')
      await deliverResult({
        sessionId: 's1',
        utteranceId: 'u1',
        speakerId: 'speaker',
        speechEndedAt: 42,
        result: speech('en-US', ['en-1'], {
          ttsAudio: small.toString('base64'),
          audioFormat: 'mp3',
        } as Partial<LanguageResult>),
        send,
        cache: cacheRef.current,
      })
      expect(sent.map((s) => s.options.topic).sort()).toEqual(
        [TOPICS.audioInline, TOPICS.caption].sort(),
      )
      const packet = sent.find((s) => s.options.topic === TOPICS.audioInline)!
      expect(packet.options.destinationIdentities).toEqual(['en-1'])
      expect(packet.data.length).toBeLessThanOrEqual(MAX_PACKET_BYTES)
      const decoded = decodeInlineAudio(packet.data)!
      expect(decoded.header).toEqual({
        utteranceId: 'u1',
        speakerId: 'speaker',
        lang: 'en-US',
        format: 'mp3',
        speechEndedAt: 42,
      })
      expect(Buffer.from(decoded.audio).equals(small)).toBe(true)
      expect(put).not.toHaveBeenCalled()
    })

    it('a bigger clip, or an API that reports no format, keeps the URL path (WAV unchanged)', async () => {
      const big = Buffer.alloc(MAX_INLINE_AUDIO_BYTES + 1, 7).toString('base64')
      for (const overrides of [
        { ttsAudio: big, audioFormat: 'mp3' },
        { ttsAudio: small.toString('base64') }, // no format field
      ]) {
        const { sent, send } = recorder()
        await deliverResult({
          sessionId: 's1',
          utteranceId: 'u1',
          speakerId: 'speaker',
          speechEndedAt: 1,
          result: speech('en-US', ['en-1'], overrides as Partial<LanguageResult>),
          send,
          cache: cacheRef.current,
        })
        expect(sent.map((s) => s.options.topic)).toEqual([TOPICS.caption, TOPICS.audio])
      }
    })

    it('the cached clip of a non-wav format is served with its own content type', async () => {
      const { sent, send, json } = recorder()
      await deliverResult({
        sessionId: 's1',
        utteranceId: 'u1',
        speakerId: 'speaker',
        speechEndedAt: 1,
        result: speech('en-US', ['en-1'], {
          ttsAudio: Buffer.alloc(MAX_INLINE_AUDIO_BYTES + 1).toString('base64'),
          audioFormat: 'mp3',
        } as Partial<LanguageResult>),
        send,
        cache: cacheRef.current,
      })
      const id = json(sent.findIndex((s) => s.options.topic === TOPICS.audio))
        .url.split('/')
        .pop()
      expect((await cacheRef.current.get(id))?.mime).toBe('audio/mpeg')
    })
  })

  describe('inline packet format', () => {
    const header = {
      utteranceId: 'u1',
      speakerId: 's',
      lang: 'en-US',
      format: 'opus' as const,
      speechEndedAt: 1,
    }
    it('round-trips, and refuses oversize clips', () => {
      const audio = new Uint8Array(MAX_INLINE_AUDIO_BYTES).fill(9)
      const packet = encodeInlineAudio(header, audio)
      expect(packet.length).toBeLessThanOrEqual(MAX_PACKET_BYTES)
      const back = decodeInlineAudio(packet)!
      expect(back.header).toEqual(header)
      expect(back.audio).toEqual(audio)
      expect(() => encodeInlineAudio(header, new Uint8Array(MAX_INLINE_AUDIO_BYTES + 1))).toThrow()
    })
    it('treats malformed packets as nothing', () => {
      expect(decodeInlineAudio(new Uint8Array([]))).toBeNull()
      expect(decodeInlineAudio(new Uint8Array([0, 0, 1]))).toBeNull() // empty header
      expect(decodeInlineAudio(new Uint8Array([0xff, 0xff, 1, 2, 3]))).toBeNull() // header too long
      expect(decodeInlineAudio(new TextEncoder().encode('{"not":"binary"}'))).toBeNull()
      const notJson = new Uint8Array([0, 3, 120, 120, 120, 1, 2])
      expect(decodeInlineAudio(notJson)).toBeNull()
    })
  })

  it('keeps every packet under the 15 KiB reliable limit, even for huge captions', async () => {
    const { sent, send } = recorder()
    const long = 'আ'.repeat(10_000)
    await deliverResult({
      sessionId: 's1',
      utteranceId: 'u1',
      speakerId: 'speaker',
      speechEndedAt: 1_761_300_000_000,
      result: speech('en-US', ['a'], {
        originalText: long,
        translatedText: long,
      } as Partial<LanguageResult>),
      send,
      cache: cacheRef.current,
    })
    for (const packet of sent) expect(packet.data.length).toBeLessThanOrEqual(MAX_PACKET_BYTES)
    expect(() => encodeMessage({ x: 'a'.repeat(MAX_PACKET_BYTES) })).toThrow(/too large/)
  })

  it('tells listeners when their language failed; sends nothing for silence', async () => {
    const { sent, send, json } = recorder()
    await deliverResult({
      sessionId: 's1',
      utteranceId: 'u1',
      speakerId: 'speaker',
      speechEndedAt: 1_761_300_000_000,
      result: { lang: 'es-ES', listeners: ['es-1'], kind: 'failed', reason: 'circuit_open', ms: 0 },
      send,
      cache: cacheRef.current,
    })
    expect(sent[0]!.options.topic).toBe(TOPICS.notice)
    expect(json(0)).toEqual({ kind: 'translation_unavailable' })
    sent.length = 0
    await deliverResult({
      sessionId: 's1',
      utteranceId: 'u2',
      speakerId: 'speaker',
      speechEndedAt: 1_761_300_000_000,
      result: { lang: 'es-ES', listeners: ['es-1'], kind: 'silence', ms: 100 },
      send,
      cache: cacheRef.current,
    })
    expect(sent).toEqual([])
  })
})

describe('GET /api/tts/[id]', () => {
  const fetchClip = (id: string) =>
    getTts(new Request('https://x/api/tts/' + id), { params: Promise.resolve({ id }) })

  it('streams the clip only to its recipients, never cached by the browser', async () => {
    const id = newAudioId()
    await cacheRef.current.put(
      id,
      { audio: Buffer.from('WAVDATA'), mime: 'audio/wav', recipients: ['en-1'] },
      60,
    )

    getSessionUser.mockResolvedValue({ id: 'en-1' })
    const ok = await fetchClip(id)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('audio/wav')
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe('WAVDATA')

    getSessionUser.mockResolvedValue({ id: 'es-1' }) // another language's listener
    expect((await fetchClip(id)).status).toBe(404)
    getSessionUser.mockResolvedValue(null)
    expect((await fetchClip(id)).status).toBe(401)
  })

  it('404 for unknown, malformed and expired ids', async () => {
    getSessionUser.mockResolvedValue({ id: 'en-1' })
    expect((await fetchClip(newAudioId())).status).toBe(404)
    expect((await fetchClip('../../etc/passwd')).status).toBe(404)
    let now = 0
    cacheRef.current = new MemoryAudioCache(1024, () => now)
    const id = newAudioId()
    await cacheRef.current.put(
      id,
      { audio: Buffer.from('x'), mime: 'audio/wav', recipients: ['en-1'] },
      60,
    )
    now = 61_000
    expect((await fetchClip(id)).status).toBe(404)
  })
})

describe('audio caches', () => {
  it('memory cache evicts the oldest clips beyond its byte budget', async () => {
    const cache = new MemoryAudioCache(10)
    await cache.put('a', { audio: Buffer.alloc(6), mime: 'audio/wav', recipients: [] }, 60)
    await cache.put('b', { audio: Buffer.alloc(6), mime: 'audio/wav', recipients: [] }, 60)
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).not.toBeNull()
  })

  it('redis cache stores audio as binary with a TTL', async () => {
    const calls: unknown[][] = []
    const store = new Map<string, Record<string, unknown>>()
    const fake = {
      multi: () => {
        const chain = {
          hset: (key: string, value: Record<string, unknown>) => (
            store.set(key, value),
            calls.push(['hset', key]),
            chain
          ),
          expire: (key: string, ttl: number) => (calls.push(['expire', key, ttl]), chain),
          exec: async () => [],
        }
        return chain
      },
      hgetBuffer: async (key: string, field: string) => (store.get(key)?.[field] as Buffer) ?? null,
      hmget: async (key: string, ...fields: string[]) =>
        fields.map((f) => (store.get(key)?.[f] as string) ?? null),
    }
    const cache = new RedisAudioCache(fake as never)
    await cache.put(
      'id1',
      { audio: Buffer.from([1, 2, 3]), mime: 'audio/wav', recipients: ['a', 'b'] },
      60,
    )
    expect(calls).toEqual([
      ['hset', 'tvx:tts:id1'],
      ['expire', 'tvx:tts:id1', 60],
    ])
    expect(await cache.get('id1')).toEqual({
      audio: Buffer.from([1, 2, 3]),
      mime: 'audio/wav',
      recipients: ['a', 'b'],
    })
    expect(await cache.get('missing')).toBeNull()
  })

  it('ids are unguessable and validated', () => {
    const id = newAudioId()
    expect(isAudioId(id)).toBe(true)
    expect(new Set(Array.from({ length: 100 }, newAudioId)).size).toBe(100)
    expect(isAudioId('short')).toBe(false)
  })
})
