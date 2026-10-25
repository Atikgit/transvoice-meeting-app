// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A MediaStreamTrack stand-in that remembers what was done to it. */
function fakeTrack(label: string) {
  const listeners = new Map<string, Set<() => void>>()
  const track = {
    label,
    enabled: true,
    muted: false,
    readyState: 'live' as 'live' | 'ended',
    stop: vi.fn(() => {
      track.readyState = 'ended'
    }),
    clone: vi.fn(() => fakeTrack(`${label} (clone)`)),
    addEventListener: (type: string, cb: () => void) =>
      listeners.set(type, (listeners.get(type) ?? new Set()).add(cb)),
    removeEventListener: (type: string, cb: () => void) => listeners.get(type)?.delete(cb),
    fire: (type: string) => listeners.get(type)?.forEach((cb) => cb()),
  }
  return track
}

let vadStream: MediaStream | undefined
const vad = {
  start: vi.fn(async () => {}),
  pause: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  listening: false,
  setOptions: vi.fn(),
}
vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: vi.fn(async (options: { getStream: () => Promise<MediaStream> }) => {
      vadStream = await options.getStream()
      return vad
    }),
  },
}))
vi.mock('@/features/translation/web-audio', () => ({ sharedAudioContext: () => null }))
const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: (...a: unknown[]) => getSessionUser(...a),
}))
const reportDiag = vi.fn()
vi.mock('@/features/translation/diag', () => ({ reportDiag }))

class FakeMediaStream {
  constructor(private readonly tracks: unknown[]) {}
  getTracks() {
    return this.tracks
  }
}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeMediaStream)
  vi.clearAllMocks()
  vadStream = undefined
})
afterEach(() => vi.unstubAllGlobals())

describe('the VAD shares the published microphone capture', () => {
  it('listens to a clone of the published track, never to the track itself', async () => {
    const { useSpeechDetector } = await import('@/features/translation/useSpeechDetector')
    const published = fakeTrack('published mic')
    const { unmount } = renderHook(() =>
      useSpeechDetector({
        track: published as unknown as MediaStreamTrack,
        listening: false,
        onUtterance: () => {},
      }),
    )
    await vi.waitFor(() => expect(vadStream).toBeDefined())
    const [used] = (vadStream as unknown as FakeMediaStream).getTracks() as ReturnType<
      typeof fakeTrack
    >[]
    expect(published.clone).toHaveBeenCalledTimes(1)
    expect(used).not.toBe(published)
    expect(used!.label).toBe('published mic (clone)')

    // Stopping the VAD ends its own copy only: the track sent to the other person is untouched.
    unmount()
    expect(used!.stop).toHaveBeenCalled()
    expect(published.stop).not.toHaveBeenCalled()
    expect(published.readyState).toBe('live')
    expect(published.enabled).toBe(true)
  })

  it('the clone listens even if the published track was muted when it was cloned', async () => {
    const { useSpeechDetector } = await import('@/features/translation/useSpeechDetector')
    const published = fakeTrack('muted mic')
    published.enabled = false
    published.clone.mockImplementation(() => {
      const copy = fakeTrack('copy')
      copy.enabled = false // clones inherit the flag
      return copy
    })
    renderHook(() =>
      useSpeechDetector({
        track: published as unknown as MediaStreamTrack,
        listening: false,
        onUtterance: () => {},
      }),
    )
    await vi.waitFor(() => expect(vadStream).toBeDefined())
    const [used] = (vadStream as unknown as FakeMediaStream).getTracks() as ReturnType<
      typeof fakeTrack
    >[]
    expect(used!.enabled).toBe(true)
    expect(published.enabled).toBe(false) // the user's mute is not touched
  })
})

describe('local microphone track watch', () => {
  it('logs when the published track is muted, unmuted or ended', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useLocalAudioWatch } = await import('@/features/translation/useLocalAudioWatch')
    const track = fakeTrack('mic')
    const { unmount } = renderHook(() =>
      useLocalAudioWatch(track as unknown as MediaStreamTrack, 'session-1'),
    )
    track.fire('mute')
    track.fire('unmute')
    track.fire('ended')
    expect(reportDiag.mock.calls.map((c) => c[0].type)).toEqual([
      'local_audio_muted',
      'local_audio_unmuted',
      'local_audio_ended',
    ])
    expect(warn).toHaveBeenCalledTimes(2)
    unmount()
    track.fire('mute') // no listener left
    expect(reportDiag).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('reports a track that is already ended when it is first seen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useLocalAudioWatch } = await import('@/features/translation/useLocalAudioWatch')
    const dead = fakeTrack('dead')
    dead.readyState = 'ended'
    renderHook(() => useLocalAudioWatch(dead as unknown as MediaStreamTrack, 's'))
    expect(reportDiag).toHaveBeenCalledWith(expect.objectContaining({ type: 'local_audio_ended' }))
    warn.mockRestore()
  })
})

describe('no second microphone capture anywhere in the room', () => {
  const ROOT = process.cwd()
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
    })

  it('getUserMedia is called only by the lobby preview, the unused dev probes and the legacy hook', () => {
    const users = ['app', 'components', 'features', 'lib']
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => /getUserMedia\(\{/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${ROOT}/`, ''))
      .sort()
    // The room (meeting-room, translation, VAD, debug overlay) must not be in this list: the
    // microphone is captured once, by LiveKit.
    expect(users).toEqual([
      'app/dev/vad/probe.tsx',
      'components/meeting/lobby.tsx',
      'features/meeting/useLocalMedia.ts',
    ])
  })

  it('useLocalMedia (a second capture) is not used by any room component', () => {
    const importers = ['app', 'components', 'features']
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => readFileSync(file, 'utf8').includes('useLocalMedia'))
      .map((file) => file.replace(`${ROOT}/`, ''))
    expect(importers).toEqual(['features/meeting/useLocalMedia.ts'])
  })
})

describe('POST /api/diag', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/diag/route')
    return POST(
      new NextRequest('https://x/api/diag', { method: 'POST', body: JSON.stringify(body) }),
    )
  }

  it('logs one line without user data; refuses strangers and junk', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    getSessionUser.mockResolvedValue({ id: 'u-secret', email: 'secret@example.com' })
    const ok = await post({
      type: 'local_audio_muted',
      sessionId: '22222222-2222-4222-8222-222222222222',
    })
    expect(ok.status).toBe(204)
    const line = String(info.mock.calls[0]![0])
    expect(JSON.parse(line)).toMatchObject({ event: 'client', type: 'local_audio_muted' })
    expect(line).not.toContain('u-secret')
    expect(line).not.toContain('secret@example.com')
    expect((await post({ type: 'nope' })).status).toBe(400)
    getSessionUser.mockResolvedValue(null)
    expect((await post({ type: 'audio_blocked' })).status).toBe(401)
    info.mockRestore()
  })
})
