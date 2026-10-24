import 'server-only'
import { randomBytes } from 'node:crypto'
import Redis from 'ioredis'
import { serverEnv } from '@/lib/env'

/** Translated TTS clips, readable only by their recipients, for 60 s. */
export interface CachedAudio {
  audio: Buffer
  mime: string
  /** User ids allowed to fetch the clip (the listeners of that language). */
  recipients: string[]
}

export interface AudioCache {
  put(id: string, entry: CachedAudio, ttlSec: number): Promise<void>
  get(id: string): Promise<CachedAudio | null>
}

export const AUDIO_TTL_SEC = 60

/** Unguessable clip id (also the URL path segment). */
export function newAudioId(): string {
  return randomBytes(18).toString('base64url')
}

export function isAudioId(value: string): boolean {
  return /^[A-Za-z0-9_-]{24}$/.test(value)
}

/** In-process LRU: fine for one container; set REDIS_URL to share clips across instances. */
export class MemoryAudioCache implements AudioCache {
  private entries = new Map<string, { entry: CachedAudio; expiresAt: number }>()
  private bytes = 0

  constructor(
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly now: () => number = Date.now,
  ) {}

  async put(id: string, entry: CachedAudio, ttlSec: number) {
    this.sweep()
    this.entries.set(id, { entry, expiresAt: this.now() + ttlSec * 1000 })
    this.bytes += entry.audio.length
    // Evict the oldest clips beyond the memory budget.
    for (const [key, value] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(key)
      this.bytes -= value.entry.audio.length
    }
  }

  async get(id: string) {
    const hit = this.entries.get(id)
    if (!hit) return null
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(id)
      this.bytes -= hit.entry.audio.length
      return null
    }
    return hit.entry
  }

  private sweep() {
    const now = this.now()
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) {
        this.entries.delete(key)
        this.bytes -= value.entry.audio.length
      }
    }
  }
}

export class RedisAudioCache implements AudioCache {
  constructor(private readonly redis: Redis) {}

  async put(id: string, entry: CachedAudio, ttlSec: number) {
    const key = `tvx:tts:${id}`
    await this.redis
      .multi()
      .hset(key, { audio: entry.audio, mime: entry.mime, recipients: entry.recipients.join(',') })
      .expire(key, ttlSec)
      .exec()
  }

  async get(id: string) {
    const key = `tvx:tts:${id}`
    const [audio, meta] = await Promise.all([
      this.redis.hgetBuffer(key, 'audio'),
      this.redis.hmget(key, 'mime', 'recipients'),
    ])
    if (!audio || !meta[0]) return null
    return { audio, mime: meta[0], recipients: (meta[1] ?? '').split(',').filter(Boolean) }
  }
}

let cache: AudioCache | undefined
export function audioCache(): AudioCache {
  if (!cache) {
    const url = serverEnv().REDIS_URL
    cache = url
      ? new RedisAudioCache(new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false }))
      : new MemoryAudioCache()
  }
  return cache
}
