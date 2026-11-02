import 'server-only'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyseWav } from '@/lib/translation/wav'

/**
 * DEBUG_CAPTURE_DROPPED (default false): keeps the assembled WAV of every utterance the speech-to-
 * text dropped as silence, so a person can listen to what the microphone really delivered. Only for
 * users listed BY EMAIL in TRANSLATION_BETA_ALLOWLIST ("*" and the built-in default do not count).
 * Files live in a private folder outside the repo and outside any public folder (mode 0700/0600),
 * are served only to the same signed-in user, and are deleted one hour after they were written
 * (checked on every write and list, and every 5 minutes). While the flag is false nothing is
 * written, the routes answer 404 and the folder is removed at boot. Audio and text are never
 * logged.
 */
export const DROPPED_TTL_MS = 60 * 60_000
const SWEEP_EVERY_MS = 5 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The only file names this feature ever creates or deletes: <user uuid>.<utterance uuid>.wav|json */
const OWN_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|json)$/i

export interface DroppedMeta {
  utteranceId: string
  sessionId: string
  createdAt: number
  expiresAt: number
  seconds: number
  peak: number
  rms: number
  /** empty | single_char | filtered_phantom | text (the translator answered "Silence") | failed */
  sttClass: string
  /** The speaker's spoken language code. */
  lang: string
}

export const captureEnabled = (): boolean => serverEnv().DEBUG_CAPTURE_DROPPED

export function captureDir(): string {
  return serverEnv().DEBUG_CAPTURE_DIR ?? join(tmpdir(), 'transvoice-dropped-audio')
}

/** Emails named explicitly in TRANSLATION_BETA_ALLOWLIST (lowercase). */
export function capturePeople(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e !== '*')
}

const emails = new Map<string, { email: string | null; at: number }>()

async function emailOf(userId: string): Promise<string | null> {
  const hit = emails.get(userId)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.email
  const { data } = await createAdminClient().auth.admin.getUserById(userId)
  const email = data.user?.email?.toLowerCase() ?? null
  if (emails.size > 500) emails.clear()
  emails.set(userId, { email, at: Date.now() })
  return email
}

/** Is this user one of the people the capture may run for? Always false while the flag is off. */
export async function captureAllowed(userId: string): Promise<boolean> {
  if (!captureEnabled()) return false
  const people = capturePeople(serverEnv().TRANSLATION_BETA_ALLOWLIST)
  if (people.length === 0) return false
  const email = await emailOf(userId)
  return email !== null && people.includes(email)
}

const base = (userId: string, utteranceId: string) => join(captureDir(), `${userId}.${utteranceId}`)

/** Deletes this feature's files older than the TTL (`maxAgeMs` 0 = all of them). */
export async function sweepDropped(now = Date.now(), maxAgeMs = DROPPED_TTL_MS): Promise<number> {
  let removed = 0
  let names: string[]
  try {
    names = await readdir(captureDir())
  } catch {
    return 0
  }
  for (const name of names) {
    if (!OWN_FILE.test(name)) continue
    const path = join(captureDir(), name)
    const age = await stat(path).then(
      (s) => now - s.mtimeMs,
      () => null,
    )
    if (age !== null && age >= maxAgeMs) {
      await rm(path, { force: true })
      removed++
    }
  }
  return removed
}

/** Keeps the audio of one dropped utterance (no-op unless the flag is on and the user is allowed). */
export async function captureDropped({
  userId,
  sessionId,
  utteranceId,
  audio,
  sttClass,
  lang,
}: {
  userId: string
  sessionId: string
  utteranceId: string
  audio: Uint8Array
  sttClass: string
  lang: string
}): Promise<boolean> {
  if (!UUID.test(userId) || !UUID.test(utteranceId) || !(await captureAllowed(userId))) return false
  const stats = analyseWav(audio)
  if (!stats) return false // only WAV is kept (what the browser uploads in chunked mode)
  await mkdir(captureDir(), { recursive: true, mode: 0o700 })
  const now = Date.now()
  const meta: DroppedMeta = {
    utteranceId,
    sessionId,
    createdAt: now,
    expiresAt: now + DROPPED_TTL_MS,
    seconds: Math.round(stats.seconds * 100) / 100,
    peak: Math.round(stats.peak * 1000) / 1000,
    rms: Math.round(stats.rms * 1000) / 1000,
    sttClass,
    lang,
  }
  await writeFile(`${base(userId, utteranceId)}.wav`, audio, { mode: 0o600 })
  await writeFile(`${base(userId, utteranceId)}.json`, JSON.stringify(meta), { mode: 0o600 })
  await sweepDropped(now)
  return true
}

/** The caller's own dropped utterances, newest first (optionally of one session). */
export async function listDropped(userId: string, sessionId?: string): Promise<DroppedMeta[]> {
  if (!captureEnabled() || !UUID.test(userId)) return []
  await sweepDropped()
  let names: string[]
  try {
    names = await readdir(captureDir())
  } catch {
    return []
  }
  const out: DroppedMeta[] = []
  for (const name of names) {
    if (!name.startsWith(`${userId}.`) || !name.endsWith('.json')) continue
    try {
      const meta = JSON.parse(await readFile(join(captureDir(), name), 'utf8')) as DroppedMeta
      if (!sessionId || meta.sessionId === sessionId) out.push(meta)
    } catch {
      // a half-written file: skipped
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** The WAV of one of the caller's own dropped utterances, or null. */
export async function readDropped(userId: string, utteranceId: string): Promise<Uint8Array | null> {
  if (!captureEnabled() || !UUID.test(userId) || !UUID.test(utteranceId)) return null
  await sweepDropped()
  try {
    return new Uint8Array(await readFile(`${base(userId, utteranceId)}.wav`))
  } catch {
    return null
  }
}

/** Boot: removes this feature's files while the flag is off; keeps a sweeper running while it is on. */
let timer: ReturnType<typeof setInterval> | undefined
export async function startDroppedCapture(): Promise<void> {
  if (!captureEnabled()) {
    await sweepDropped(Date.now(), 0)
    return
  }
  await sweepDropped()
  timer ??= setInterval(() => void sweepDropped().catch(() => {}), SWEEP_EVERY_MS)
  timer.unref()
}

export function stopDroppedCapture(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
