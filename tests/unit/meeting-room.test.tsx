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
  tracks: [] as {
    source: string
    participant: { identity: string; isLocal: boolean; name: string }
  }[],
  setMicrophoneEnabled: vi.fn(async () => {}),
  setCameraEnabled: vi.fn(async () => {}),
  rerender: () => {},
  roomProps: {} as {
    audio?: unknown
    video?: unknown
    options?: unknown
    onDisconnected?: (reason?: number) => void
    onError?: (error: Error) => void
    onMediaDeviceFailure?: (failure?: string, kind?: string) => void
  },
  audioBlocked: false,
  enableAudio: vi.fn(),
  translationNotice: null as null | Record<string, unknown>,
  startAudio: vi.fn(async () => {}),
}
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({
    children,
    ...props
  }: {
    children: ReactNode
    audio: unknown
    video: unknown
    onDisconnected?: (reason?: number) => void
  }) => {
    lk.roomProps = props
    return <>{children}</>
  },
  useRoomContext: () => ({
    startAudio: lk.startAudio,
    canPlaybackAudio: true,
    on: vi.fn(),
    off: vi.fn(),
  }),
  usePersistentUserChoices: () => ({
    userChoices: { audioDeviceId: 'mic-2', videoDeviceId: 'default' },
  }),
  RoomAudioRenderer: () => null,
  useRoomInfo: () => ({ metadata: lk.metadata, name: 'tv-room' }),
  useConnectionState: () => lk.connection,
  useRemoteParticipants: () => lk.remotes,
  useTracks: () => lk.tracks,
  useLocalParticipant: () => ({
    localParticipant: {
      setMicrophoneEnabled: lk.setMicrophoneEnabled,
      setCameraEnabled: lk.setCameraEnabled,
    },
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    isScreenShareEnabled: false,
  }),
}))
vi.mock('@/features/meeting/useAudioPlayback', () => ({
  useAudioPlayback: () => ({ blocked: lk.audioBlocked, enable: lk.enableAudio }),
}))
vi.mock('livekit-client', () => ({
  Room: { getLocalDevices: vi.fn(async () => []) },
  RoomEvent: {},
  ConnectionState: {
    Connecting: 'connecting',
    Reconnecting: 'reconnecting',
    Connected: 'connected',
  },
  Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } },
  VideoPresets: { h720: { resolution: { width: 1280, height: 720 } } },
  DisconnectReason: {
    UNKNOWN_REASON: 0,
    CLIENT_INITIATED: 1,
    DUPLICATE_IDENTITY: 2,
    SERVER_SHUTDOWN: 3,
    PARTICIPANT_REMOVED: 4,
    ROOM_DELETED: 5,
  },
}))
vi.mock('@/components/meeting/participant-tile', () => ({
  ParticipantTile: ({
    trackRef,
  }: {
    trackRef: { participant: { name: string }; source: string }
  }) => (
    <div data-testid="participant-tile">
      {trackRef.participant.name}:{trackRef.source}
    </div>
  ),
}))
vi.mock('@/features/calls/useUserChannel', () => ({ useUserChannel: () => {} }))
vi.mock('@/features/translation/useTranslatedAudio', () => ({
  useTranslatedAudio: () => ({
    captions: [],
    playing: false,
    unavailable: false,
    latency: null,
    addOwnTranscript: () => {},
  }),
}))
vi.mock('@/features/translation/useLiveTranslation', () => ({
  useLiveTranslation: () => ({
    listening: false,
    speaking: false,
    translating: false,
    notice: lk.translationNotice,
  }),
}))
vi.mock('@/components/meeting/device-menu', () => ({ DeviceMenu: () => <button>Devices</button> }))
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
      originalAudioMode="duck"
      translationEnabled
      spokenLang="bn-BD"
      listenLang="en-US"
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
        originalAudioMode="duck"
        translationEnabled
        spokenLang="bn-BD"
        listenLang="en-US"
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
  lk.audioBlocked = false
  lk.roomProps = {}
  lk.translationNotice = null
  lk.enableAudio.mockClear()
  lk.remotes = [{ identity: 'g1', name: 'Guest' }]
  lk.tracks = [
    { source: 'camera', participant: { identity: 'u1', isLocal: true, name: 'Atik' } },
    { source: 'screen_share', participant: { identity: 'g1', isLocal: false, name: 'Guest' } },
    { source: 'camera', participant: { identity: 'g1', isLocal: false, name: 'Guest' } },
  ]
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
      signal: expect.any(AbortSignal),
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

  it('says Connecting… (not Reconnecting…) on the first connection', async () => {
    lk.connection = 'connecting'
    room('guest')
    await waitFor(() => expect(screen.getByTestId('room-status')).toHaveTextContent('Connecting…'))
    expect(screen.queryByText(/Reconnecting/)).toBeNull()
  })

  it('shows Reconnecting… while LiveKit reconnects', async () => {
    lk.connection = 'reconnecting'
    room('guest', LIVE)
    await waitFor(() =>
      expect(screen.getByTestId('room-status')).toHaveTextContent('Reconnecting…'),
    )
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

describe('Lobby choices in the room', () => {
  it('publishes with the lobby microphone; camera off when chosen off', async () => {
    render(
      <MeetingRoom
        meetingId="11111111-1111-4111-8111-111111111111"
        sessionId={SESSION}
        userId="u1"
        role="guest"
        roomName="m-room"
        title="Translated meeting"
        displayName="Atik"
        originalAudioMode="duck"
        translationEnabled
        spokenLang="bn-BD"
        listenLang="en-US"
        initialState={READY}
        initialCamera={false}
        initialMic
      />,
    )
    await screen.findByText('Waiting for host to start…')
    expect(lk.roomProps.audio).toMatchObject({
      deviceId: 'mic-2',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
    expect(lk.roomProps.video).toBe(false)
    expect(lk.roomProps.options).toMatchObject({ adaptiveStream: true, dynacast: true })
  })
})

describe('Reconnect (Rule 5)', () => {
  it('shows a Reconnecting banner while LiveKit reconnects', async () => {
    lk.connection = 'reconnecting'
    room('guest', LIVE)
    expect(await screen.findByText(/Reconnecting… your call continues/)).toBeInTheDocument()
  })

  it('a lost connection offers Call again (through /api/calls)', async () => {
    room('guest', LIVE)
    await screen.findByText(/^Live \d/)
    act(() => lk.roomProps.onDisconnected?.(3)) // SERVER_SHUTDOWN / network gone
    expect(
      screen.getByText('Connection lost. The meeting could not reconnect.'),
    ).toBeInTheDocument()
    respond('/api/calls', 200, { mode: 'join', redirect: '/m/x/lobby' })
    fireEvent.click(screen.getByRole('button', { name: /Call again/ }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/calls',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('leaving on purpose is not a lost connection', async () => {
    room('guest', LIVE)
    await screen.findByText(/^Live \d/)
    act(() => lk.roomProps.onDisconnected?.(1)) // CLIENT_INITIATED
    expect(screen.queryByText(/Connection lost/)).toBeNull()
  })

  it('a session ended by the grace timeout shows Call again', async () => {
    room('guest', LIVE)
    await screen.findByText(/^Live \d/)
    metadataChanged({ ...LIVE, status: 'ended', endReason: 'reconnect_timeout' })
    expect(screen.getByText('The connection was lost and the meeting ended.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Call again/ })).toBeInTheDocument()
  })
})

describe('Joining a session that is already live', () => {
  it('shows Live and the timer at once when the room metadata is live on connect', async () => {
    lk.metadata = JSON.stringify(LIVE)
    room('guest', READY) // the page rendered a moment before the host pressed Start
    expect(await screen.findByText(/^Live \d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.queryByText('Waiting for host to start…')).toBeNull()
  })

  it('catches up from the server when the metadata update never arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/livekit/token'))
          return new Response(JSON.stringify({ token: 't', url: 'wss://lk.test' }))
        if (url === `/api/calls/${SESSION}/state`) return new Response(JSON.stringify(LIVE))
        return new Response('{}', { status: 404 })
      })
      room('guest', READY) // metadata stays "ready"/absent
      await vi.waitFor(() => expect(screen.getByText(/^Live \d\d:\d\d$/)).toBeInTheDocument())
      expect(screen.queryByText('Waiting for host to start…')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps asking while still ready, and stops once live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let answers = 0
      fetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/livekit/token'))
          return new Response(JSON.stringify({ token: 't', url: 'wss://lk.test' }))
        if (url === `/api/calls/${SESSION}/state`) {
          answers++
          return new Response(JSON.stringify(answers < 3 ? READY : LIVE))
        }
        return new Response('{}', { status: 404 })
      })
      room('guest', READY)
      await vi.waitFor(() => expect(answers).toBe(1))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect(await screen.findByText(/^Live \d\d:\d\d$/)).toBeInTheDocument()
      const seen = answers
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
      })
      expect(answers).toBe(seen)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('First connection', () => {
  afterEach(() => vi.useRealTimers())

  it('says Connecting… and, after 15 s without a connection, offers Retry (not Call again)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    lk.connection = 'connecting'
    room('host')
    // The LiveKit room mounts once the token has arrived; the 15 s clock starts there.
    await vi.waitFor(() => expect(lk.roomProps.onError).toBeDefined())
    expect(screen.getByTestId('room-status')).toHaveTextContent('Connecting…')
    expect(screen.queryByText(/Can't reach the meeting server/)).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText(/Can't reach the meeting server/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Call again/ })).toBeNull()

    const tokenCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/livekit/token')).length
    expect(tokenCalls()).toBe(1)
    lk.connection = 'connected'
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(tokenCalls()).toBe(2) // a fresh token, not the old one
  })

  it('a connection that fails outright shows the same Retry, not "Connection lost"', async () => {
    lk.connection = 'connecting'
    room('host')
    await screen.findByTestId('room-status')
    act(() => lk.roomProps.onError?.(new Error('could not establish signal connection')))
    expect(screen.getByText(/Can't reach the meeting server/)).toBeInTheDocument()
    expect(screen.queryByText(/Connection lost/)).toBeNull()
  })

  it('does not time out once connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    room('host')
    await vi.waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.queryByText(/Can't reach the meeting server/)).toBeNull()
  })
})

describe('Error states', () => {
  it('permission denied explains how to allow it in the browser and offers Reload', async () => {
    room('host')
    await screen.findByText('Ready')
    act(() => lk.roomProps.onMediaDeviceFailure?.('PermissionDenied', 'audioinput'))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/blocking the microphone/)
    expect(alert).toHaveTextContent(/lock icon/)
    expect(alert).toHaveTextContent(/Settings → Safari/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('a microphone in use by another app (NotReadableError) can be retried', async () => {
    room('host')
    await screen.findByText('Ready')
    act(() => lk.roomProps.onMediaDeviceFailure?.('DeviceInUse', 'audioinput'))
    expect(screen.getByRole('alert')).toHaveTextContent(/used by another app/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(lk.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(screen.queryByText(/used by another app/)).toBeNull()
  })

  it('a blocked camera retries the camera, not the microphone', async () => {
    room('host')
    await screen.findByText('Ready')
    act(() => lk.roomProps.onMediaDeviceFailure?.('NotFound', 'videoinput'))
    expect(screen.getByRole('alert')).toHaveTextContent(/No camera found/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(lk.setCameraEnabled).toHaveBeenCalledWith(true)
  })

  it('when the host has no minutes, a guest can Message host or Subscribe', async () => {
    lk.translationNotice = {
      tone: 'error',
      text: "The host's minutes have run out. Translation is paused; chat still works.",
      code: 'PAYER_NO_MINUTES',
      payerIsSpeaker: false,
    }
    room('guest', LIVE)
    expect(await screen.findAllByText(/host's minutes have run out/)).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Message host' }))
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
  })

  it('the paying speaker only gets Subscribe', async () => {
    lk.translationNotice = {
      tone: 'error',
      text: 'You have no minutes left.',
      code: 'PAYER_NO_MINUTES',
      payerIsSpeaker: true,
    }
    room('host', LIVE)
    expect(await screen.findByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Message host' })).toBeNull()
  })

  it('shows "Tap to enable audio" while the browser blocks playback, and enables on tap', async () => {
    lk.audioBlocked = true
    room('guest', LIVE)
    fireEvent.click(await screen.findByRole('button', { name: 'Tap to enable audio' }))
    expect(lk.enableAudio).toHaveBeenCalled()
  })

  it('Start unlocks audio inside the click', async () => {
    respond('/api/calls/start', 200, {})
    room('host')
    await screen.findByText('Ready')
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }))
    expect(lk.startAudio).toHaveBeenCalled()
  })
})

describe('Private beta', () => {
  it('says so in the caption bar when translation is not enabled for this meeting', async () => {
    render(
      <MeetingRoom
        meetingId="11111111-1111-4111-8111-111111111111"
        sessionId={SESSION}
        userId="u1"
        role="guest"
        roomName="m-room"
        title="Translated meeting"
        displayName="Atik"
        originalAudioMode="duck"
        translationEnabled={false}
        spokenLang="bn-BD"
        listenLang="en-US"
        initialState={LIVE}
        initialCamera
        initialMic
      />,
    )
    expect(await screen.findByText('Live translation is in private beta.')).toBeInTheDocument()
  })
})

describe('MeetingRoom tiles', () => {
  it('orders screen share, remote camera, then your own camera; devices menu present', async () => {
    room('host')
    await screen.findByText('Ready')
    expect(screen.getAllByTestId('participant-tile').map((t) => t.textContent)).toEqual([
      'Guest:screen_share',
      'Guest:camera',
      'Atik:camera',
    ])
    expect(screen.getByRole('button', { name: 'Devices' })).toBeInTheDocument()
  })

  it('shows a waiting tile while alone', async () => {
    lk.remotes = []
    lk.tracks = [{ source: 'camera', participant: { identity: 'u1', isLocal: true, name: 'Atik' } }]
    room('host')
    expect(await screen.findByText('Waiting for partner to join...')).toBeInTheDocument()
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
