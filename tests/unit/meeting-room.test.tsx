// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomState } from '@/lib/meetings/room-state'

// Controllable stand-ins for the LiveKit room.
const lk = {
  metadata: undefined as string | undefined,
  connection: 'connected',
  remotes: [] as { identity: string; name: string }[],
  setMicrophoneEnabled: vi.fn(),
  setCameraEnabled: vi.fn(),
  rerender: () => {},
}
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => <>{children}</>,
  RoomAudioRenderer: () => null,
  useRoomInfo: () => ({ metadata: lk.metadata, name: 'tv-room' }),
  useConnectionState: () => lk.connection,
  useRemoteParticipants: () => lk.remotes,
  useLocalParticipant: () => ({
    localParticipant: {
      setMicrophoneEnabled: lk.setMicrophoneEnabled,
      setCameraEnabled: lk.setCameraEnabled,
    },
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
  }),
}))
vi.mock('livekit-client', () => ({
  ConnectionState: { Reconnecting: 'reconnecting', Connected: 'connected' },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/app/invite/actions', () => ({ createInvitation: vi.fn() }))
vi.mock('@/features/meeting/useMeetingChat', () => ({
  useMeetingChat: () => ({ messages: [], send: vi.fn() }),
}))

const { MeetingRoom } = await import('@/components/meeting/meeting-room')

const SESSION = '22222222-2222-4222-8222-222222222222'
const READY: RoomState = { status: 'ready', startedAt: null, hostId: 'host-1' }
const LIVE: RoomState = {
  status: 'live',
  startedAt: new Date().toISOString(),
  hostId: 'host-1',
}

let fetchMock: ReturnType<typeof vi.fn>
function respond(path: string, status: number, body: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/livekit/token')) {
      return new Response(JSON.stringify({ token: 't', url: 'wss://lk.test' }), { status: 200 })
    }
    if (url === path) return new Response(JSON.stringify(body), { status })
    return new Response('{}', { status: 404 })
  })
}

const room = (role: 'host' | 'guest', initialState: RoomState = READY) => {
  const utils = render(
    <MeetingRoom
      meetingId="11111111-1111-4111-8111-111111111111"
      sessionId={SESSION}
      userId="u1"
      role={role}
      roomName="m-room"
      title="Translated meeting"
      displayName="Atik"
      initialState={initialState}
      initialCamera
      initialMic
    />,
  )
  lk.rerender = () =>
    utils.rerender(
      <MeetingRoom
        meetingId="11111111-1111-4111-8111-111111111111"
        sessionId={SESSION}
        userId="u1"
        role={role}
        roomName="m-room"
        title="Translated meeting"
        displayName="Atik"
        initialState={initialState}
        initialCamera
        initialMic
      />,
    )
  return utils
}

/** The server changes the room metadata (RoomMetadataChanged). */
function metadataChanged(state: RoomState) {
  lk.metadata = JSON.stringify(state)
  act(() => lk.rerender())
}

beforeEach(() => {
  lk.metadata = undefined
  lk.connection = 'connected'
  lk.remotes = [{ identity: 'g1', name: 'Guest' }]
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  respond('', 404, {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MeetingRoom (LiveKit)', () => {
  it('asks for a token for its session, then opens Ready', async () => {
    room('host')
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/livekit/token?sessionId=${SESSION}`, {
      cache: 'no-store',
    })
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('host Start calls the server; the room goes live from the metadata', async () => {
    respond(`/api/calls/${SESSION}/start`, 200, LIVE)
    room('host')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/calls/${SESSION}/start`, { method: 'POST' }),
    )
    expect(await screen.findByText(/^Live \d\d:\d\d$/)).toBeInTheDocument()
    metadataChanged(LIVE)
    expect(screen.getByRole('button', { name: 'End meeting' })).toBeInTheDocument()
  })

  it('shows "Get minutes" when the host has no minutes', async () => {
    respond(`/api/calls/${SESSION}/start`, 402, {
      code: 'NO_MINUTES',
      error: 'You have no minutes left.',
    })
    room('host')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You have no minutes left.')
    expect(screen.getByRole('button', { name: 'Get minutes' })).toBeInTheDocument()
  })

  it('guest waits for the host, follows the metadata to live, then to ended', async () => {
    room('guest')
    expect(await screen.findByText('Waiting for host to start…')).toBeInTheDocument()
    metadataChanged(LIVE)
    expect(screen.queryByText('Waiting for host to start…')).toBeNull()
    expect(screen.getByText(/^Live \d\d:\d\d$/)).toBeInTheDocument()
    metadataChanged({ ...LIVE, status: 'ended', endReason: 'host_ended' })
    expect(screen.getByText('The host ended the meeting.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('shows Reconnecting… while LiveKit reconnects', async () => {
    lk.connection = 'reconnecting'
    room('guest', LIVE)
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument()
  })

  it('explains a refused token and offers the way back', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'NOT_ALLOWED', error: 'You are not invited to this meeting.' }),
        {
          status: 403,
        },
      ),
    )
    room('guest')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are not invited to this meeting.',
    )
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('mic and camera buttons drive the LiveKit local participant', async () => {
    room('host')
    fireEvent.click(await screen.findByRole('button', { name: 'Mute microphone' }))
    expect(lk.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off camera' }))
    expect(lk.setCameraEnabled).toHaveBeenCalledWith(false)
  })
})

describe('parseRoomState', () => {
  it('reads valid metadata and falls back on anything else', async () => {
    const { parseRoomState } = await import('@/lib/meetings/room-state')
    expect(parseRoomState(JSON.stringify(LIVE), READY)).toEqual({ ...LIVE, endReason: undefined })
    expect(parseRoomState('not json', READY)).toBe(READY)
    expect(parseRoomState(JSON.stringify({ status: 'hacked' }), READY)).toBe(READY)
    expect(parseRoomState(undefined, READY)).toBe(READY)
  })
})
