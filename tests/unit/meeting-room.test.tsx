// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '@/features/meeting/types'

const actions = {
  startMeetingSession: vi.fn(),
  joinMeetingSession: vi.fn(),
  endMeetingSession: vi.fn(),
}
const translator = vi.fn()
const broadcastSessionState = vi.fn()
let channelOptions: { onSessionState?: (s: SessionState) => void } = {}

vi.mock('@/app/m/actions', () => actions)
vi.mock('@/app/invite/actions', () => ({ createInvitation: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/meeting/useLocalMedia', () => ({ useLocalMedia: () => null }))
vi.mock('@/features/translation/useLegacyChunkTranslator', () => ({
  useLegacyChunkTranslator: (options: { enabled: boolean }) => translator(options.enabled),
}))
vi.mock('@/features/meeting/useLegacyRoomChannel', () => ({
  useLegacyRoomChannel: (options: typeof channelOptions) => {
    channelOptions = options
    return {
      partnerConnected: true,
      partnerName: 'Partner',
      messages: [{ id: '0', sender: 'System', text: 'hi', time: 'Now' }],
      sendChat: vi.fn(),
      broadcastTranslation: vi.fn(),
      broadcastSessionState,
    }
  },
}))

const { MeetingRoom } = await import('@/components/meeting/meeting-room')

const room = (role: 'host' | 'guest', initialSession: SessionState = { status: 'ready' }) =>
  render(
    <MeetingRoom
      meetingId="11111111-1111-4111-8111-111111111111"
      userId="u1"
      role={role}
      roomName="m-room"
      displayName="Atik"
      listenLang="en-US"
      initialSession={initialSession}
      initialCamera
      initialMic
    />,
  )

const LIVE: SessionState = {
  status: 'live',
  sessionId: '22222222-2222-4222-8222-222222222222',
  startedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.startMeetingSession.mockResolvedValue({ ok: true, ...LIVE })
  actions.joinMeetingSession.mockResolvedValue({ ok: true })
  actions.endMeetingSession.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('MeetingRoom lifecycle', () => {
  it('opens ready: translation idle and timer stopped', () => {
    room('host')
    expect(translator).toHaveBeenLastCalledWith(false)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText(/^Live \d/)).toBeNull()
  })

  it('host Start: goes live, starts translation, broadcasts; then End meeting', async () => {
    room('host')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start$/ })))
    expect(actions.startMeetingSession).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(translator).toHaveBeenLastCalledWith(true)
    expect(screen.getByText(/^Live \d\d:\d\d$/)).toBeInTheDocument()
    expect(broadcastSessionState).toHaveBeenCalledWith(LIVE)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /End meeting/ })))
    expect(actions.endMeetingSession).toHaveBeenCalledWith(LIVE.sessionId)
    expect(broadcastSessionState).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(translator).toHaveBeenLastCalledWith(false)
  })

  it('host without minutes sees "Get minutes"', async () => {
    actions.startMeetingSession.mockResolvedValue({
      ok: false,
      code: 'NO_MINUTES',
      error: 'You have no minutes left.',
    })
    room('host')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start$/ })))
    expect(screen.getByRole('alert')).toHaveTextContent('You have no minutes left.')
    expect(screen.getByRole('button', { name: 'Get minutes' })).toBeInTheDocument()
    expect(translator).toHaveBeenLastCalledWith(false)
  })

  it('guest waits for the host, then joins the live session when it starts', async () => {
    room('guest')
    expect(screen.getByText('Waiting for host to start…')).toBeInTheDocument()
    expect(translator).toHaveBeenLastCalledWith(false)

    await act(async () => channelOptions.onSessionState?.(LIVE))
    expect(actions.joinMeetingSession).toHaveBeenCalledWith(LIVE.sessionId, LIVE.startedAt)
    expect(translator).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText('Waiting for host to start…')).toBeNull()

    await act(async () => channelOptions.onSessionState?.({ status: 'ready' }))
    expect(screen.getByText('The host ended the meeting.')).toBeInTheDocument()
  })

  it('a guest arriving during a live meeting joins it right away', async () => {
    await act(async () => room('guest', LIVE))
    expect(actions.joinMeetingSession).toHaveBeenCalledOnce()
  })
})
