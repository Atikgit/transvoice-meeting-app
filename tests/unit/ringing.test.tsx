// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const httpSend = vi.fn()
const channelNames: { name: string; private?: boolean }[] = []
const profile = vi.fn()
const sessionRow = vi.fn()
const getSessionUser = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    channel: (name: string, opts: { config: { private: boolean } }) => {
      channelNames.push({ name, private: opts.config.private })
      return { httpSend }
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'profiles' ? profile() : sessionRow() }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))

// Browser side: capture the user channel handlers and its status callback.
const channelHandlers: Record<string, (msg: { payload: unknown }) => void> = {}
const browser = {
  channelsCreated: 0,
  removed: 0,
  status: (_s: string) => {},
}
const browserClient = {
  realtime: { setAuth: vi.fn(async () => {}) },
  channel: () => {
    browser.channelsCreated++
    const ch = {
      on: (
        _type: string,
        { event }: { event: string },
        handler: (m: { payload: unknown }) => void,
      ) => {
        channelHandlers[event] = handler
        return ch
      },
      subscribe: (cb?: (s: string) => void) => {
        browser.status = cb ?? (() => {})
        return ch
      },
    }
    return ch
  },
  removeChannel: vi.fn(() => {
    browser.removed++
  }),
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => browserClient }))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const { POST: createCall } = await import('@/app/api/calls/route')
const { POST: accept } = await import('@/app/api/calls/[id]/accept/route')
const { POST: cancel } = await import('@/app/api/calls/[id]/cancel/route')
const { IncomingCallListener } = await import('@/components/calls/incoming-call')
const { ConnectionsCard } = await import('@/components/calls/connections-card')

const MEETING = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'
const inFuture = (s: number) => new Date(Date.now() + s * 1000).toISOString()
const callReq = (body: unknown) =>
  new NextRequest('https://meet.transvoice.ai/api/calls', {
    method: 'POST',
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ id: SESSION }) }
const post = new Request('https://meet.transvoice.ai/x', { method: 'POST' })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  channelNames.length = 0
  browser.channelsCreated = 0
  browser.removed = 0
  getSessionUser.mockResolvedValue({ id: 'guest-1' })
  profile.mockReturnValue({ full_name: 'Guest Person' })
  sessionRow.mockReturnValue({ initiated_by: 'guest-1' })
  httpSend.mockResolvedValue({ success: true })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('POST /api/calls', () => {
  it('sponsored guest: rings the sponsor on their private user channel', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          mode: 'ringing',
          meeting_id: MEETING,
          session_id: SESSION,
          callee_id: 'host-1',
          expires_at: 'T',
        },
      ],
      error: null,
    })
    const res = await createCall(callReq({ meetingId: MEETING }))
    expect(await res.json()).toMatchObject({ mode: 'ringing', sessionId: SESSION })
    expect(channelNames).toEqual([{ name: 'user:host-1', private: true }])
    expect(httpSend).toHaveBeenCalledWith('incoming_call', {
      sessionId: SESSION,
      meetingId: MEETING,
      callerName: 'Guest Person',
      expiresAt: 'T',
      fromHost: false,
    })
  })

  it('the host’s Call rings the guest, flagged fromHost, and logs the publish', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    getSessionUser.mockResolvedValue({ id: 'host-1' })
    sessionRow.mockReturnValue({ owner_id: 'host-1' }) // the meetings row
    rpc.mockResolvedValue({
      data: [
        {
          mode: 'ringing',
          meeting_id: MEETING,
          session_id: SESSION,
          callee_id: 'guest-9',
          expires_at: 'T',
        },
      ],
      error: null,
    })
    const res = await createCall(callReq({ meetingId: MEETING }))
    expect(await res.json()).toMatchObject({ mode: 'ringing', sessionId: SESSION })
    expect(channelNames).toEqual([{ name: 'user:guest-9', private: true }])
    expect(httpSend).toHaveBeenCalledWith(
      'incoming_call',
      expect.objectContaining({ fromHost: true, sessionId: SESSION }),
    )
    const lines = info.mock.calls.map((c) => String(c[0]))
    expect(lines).toContainEqual(
      expect.stringContaining('"event":"notify","type":"incoming_call","ok":true'),
    )
    expect(lines).toContainEqual(expect.stringContaining('"event":"call","action":"ringing"'))
    expect(lines.join('')).not.toContain('guest-9') // no ids of people in the log
    info.mockRestore()
  })

  it('a failed publish is logged as a failure, not swallowed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    httpSend.mockRejectedValue(new Error('realtime down'))
    rpc.mockResolvedValue({
      data: [
        {
          mode: 'ringing',
          meeting_id: MEETING,
          session_id: SESSION,
          callee_id: 'host-1',
          expires_at: 'T',
        },
      ],
      error: null,
    })
    expect((await createCall(callReq({ meetingId: MEETING }))).status).toBe(200)
    expect(String(error.mock.calls[0]![0])).toContain('"event":"notify"')
    expect(String(error.mock.calls[0]![0])).toContain('"ok":false')
    error.mockRestore()
  })

  it('host or already open: straight to the lobby, nobody rings', async () => {
    rpc.mockResolvedValue({ data: [{ mode: 'direct', meeting_id: MEETING }], error: null })
    expect(await (await createCall(callReq({ meetingId: MEETING }))).json()).toEqual({
      mode: 'direct',
      redirect: `/m/${MEETING}/lobby`,
    })
    expect(httpSend).not.toHaveBeenCalled()
  })

  it('expired window and 0 minutes: 402 with Subscribe / Message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NO_MINUTES' } })
    const res = await createCall(callReq({ meetingId: MEETING }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ options: ['subscribe', 'message'] })
  })

  it('validates input and auth', async () => {
    expect((await createCall(callReq({}))).status).toBe(400)
    getSessionUser.mockResolvedValueOnce(null)
    expect((await createCall(callReq({ meetingId: MEETING }))).status).toBe(401)
  })
})

describe('accept / cancel', () => {
  it('accept tells the caller and sends both to the lobby', async () => {
    getSessionUser.mockResolvedValue({ id: 'host-1' })
    rpc.mockResolvedValue({ data: [{ meeting_id: MEETING, outcome: 'accepted' }], error: null })
    const res = await accept(post, params)
    expect(await res.json()).toEqual({ outcome: 'accepted', redirect: `/m/${MEETING}/lobby` })
    expect(channelNames[0]).toEqual({ name: 'user:guest-1', private: true })
    expect(httpSend).toHaveBeenCalledWith('call_answered', {
      sessionId: SESSION,
      meetingId: MEETING,
      outcome: 'accepted',
    })
  })

  it('a call that already timed out answers 410', async () => {
    rpc.mockResolvedValue({ data: [{ meeting_id: MEETING, outcome: 'expired' }], error: null })
    expect((await accept(post, params)).status).toBe(410)
    expect(httpSend).not.toHaveBeenCalled()
  })

  it('cancel marks missed and closes the callee modal', async () => {
    rpc.mockResolvedValue({ data: 'host-1', error: null })
    await cancel(post, params)
    expect(rpc).toHaveBeenCalledWith('cancel_call', { p_session: SESSION, p_user: 'guest-1' })
    expect(httpSend).toHaveBeenCalledWith('call_cancelled', { sessionId: SESSION })
  })
})

describe('IncomingCallListener', () => {
  it('rings on incoming_call, Accept opens the lobby', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/calls/incoming'
        ? new Response(JSON.stringify({ calls: [] }))
        : new Response(JSON.stringify({ outcome: 'accepted', redirect: `/m/${MEETING}/lobby` })),
    )
    render(<IncomingCallListener userId="host-1" />)
    await waitFor(() => expect(channelHandlers.incoming_call).toBeDefined()) // joined after setAuth
    act(() =>
      channelHandlers.incoming_call!({
        payload: {
          sessionId: SESSION,
          meetingId: MEETING,
          callerName: 'Rahim',
          expiresAt: inFuture(30),
        },
      }),
    )
    expect(screen.getByText('Rahim is calling')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/m/${MEETING}/lobby`))
    expect(fetchMock).toHaveBeenCalledWith(`/api/calls/${SESSION}/accept`, { method: 'POST' })
  })

  it('shows a call that was already ringing, and hides it when the caller cancels', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          calls: [
            {
              sessionId: SESSION,
              meetingId: MEETING,
              callerName: 'Rahim',
              expiresAt: inFuture(20),
            },
          ],
        }),
      ),
    )
    render(<IncomingCallListener userId="host-1" />)
    expect(await screen.findByText('Rahim is calling')).toBeInTheDocument()
    act(() => channelHandlers.call_cancelled!({ payload: { sessionId: SESSION } }))
    expect(screen.queryByText('Rahim is calling')).toBeNull()
  })
})

describe('ringing never depends on Realtime alone', () => {
  const ringing = (id = SESSION, meetingId = MEETING, fromHost = true) => ({
    sessionId: id,
    meetingId,
    callerName: 'Rahim',
    expiresAt: inFuture(30),
    fromHost,
  })

  it('polls /api/calls/incoming every 3 s: a ring Realtime lost still pops up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls: unknown[] = []
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ calls })))
    render(<IncomingCallListener userId="guest-1" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.queryByText('Rahim is calling')).toBeNull()
    calls = [ringing()] // the host presses Call; the Realtime event never arrives
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(await screen.findByText('Rahim is calling')).toBeInTheDocument()
    expect(screen.getByText(/Accepting joins Rahim's meeting/)).toBeInTheDocument()
  })

  it('on a meeting’s own lobby / room page a call for that meeting is not shown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ calls: [ringing()] })))
    render(<IncomingCallListener userId="guest-1" currentMeetingId={MEETING} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    await waitFor(() => expect(channelHandlers.incoming_call).toBeDefined())
    expect(screen.queryByText('Rahim is calling')).toBeNull()
    act(() => channelHandlers.incoming_call!({ payload: ringing() }))
    expect(screen.queryByText('Rahim is calling')).toBeNull()
    // ...but a call for another meeting still rings.
    act(() =>
      channelHandlers.incoming_call!({
        payload: {
          ...ringing(
            '55555555-5555-4555-8555-555555555555',
            '66666666-6666-4666-8666-666666666666',
          ),
          callerName: 'Other',
        },
      }),
    )
    expect(screen.getByText('Other is calling')).toBeInTheDocument()
  })

  it('a ring that ran out does not hide the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls: unknown[] = [{ ...ringing(), expiresAt: inFuture(1) }]
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ calls })))
    render(<IncomingCallListener userId="guest-1" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByText('Rahim is calling')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByText('Rahim is calling')).toBeNull() // timed out
    calls = [{ ...ringing('77777777-7777-4777-8777-777777777777'), callerName: 'Second' }]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(await screen.findByText('Second is calling')).toBeInTheDocument()
  })
})

describe('the Realtime channel', () => {
  it('is shared by every listener on the page: one subscription, and leaving one keeps it for the other', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ calls: [] })))
    const first = render(<IncomingCallListener userId="guest-1" />)
    const second = render(
      <ConnectionsCard userId="guest-1" connections={[]} canSpend onSubscribe={vi.fn()} />,
    )
    return waitFor(() => expect(browser.channelsCreated).toBe(1)).then(() => {
      second.unmount()
      expect(browser.removed).toBe(0) // the incoming-call modal still listens
      first.unmount()
      expect(browser.removed).toBe(1)
    })
  })

  it('sets the access token before joining and re-subscribes after an error, telling the server log', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ calls: [] })))
    render(<IncomingCallListener userId="guest-1" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(browserClient.realtime.setAuth).toHaveBeenCalled()
    expect(browser.channelsCreated).toBe(1)

    act(() => browser.status('SUBSCRIBED'))
    act(() => browser.status('CHANNEL_ERROR'))
    expect(browser.removed).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/diag',
      expect.objectContaining({ body: expect.stringContaining('CHANNEL_ERROR') }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(browser.channelsCreated).toBe(2) // a fresh channel after 1 s
  })
})

describe('ConnectionsCard', () => {
  const card = (
    canSpend: boolean,
    items = [
      { meetingId: MEETING, name: 'Sponsor', role: 'guest' as const, expiresAt: inFuture(3600) },
      {
        meetingId: '33333333-3333-4333-8333-333333333333',
        name: 'Old host',
        role: 'guest' as const,
        expiresAt: inFuture(-60),
      },
      {
        meetingId: '44444444-4444-4444-8444-444444444444',
        name: 'My guest',
        role: 'sponsor' as const,
        expiresAt: inFuture(60),
      },
    ],
  ) =>
    render(
      <ConnectionsCard
        userId="guest-1"
        connections={items}
        canSpend={canSpend}
        onSubscribe={vi.fn()}
      />,
    )

  it('valid guest → Call; expired guest with 0 minutes → Subscribe / Message; sponsor → Open room', () => {
    card(false)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Call')
    expect(rows[1]).toHaveTextContent('Subscribe')
    expect(rows[1]).toHaveTextContent('Message')
    expect(rows[1]).not.toHaveTextContent(/\bCall\b/)
    // The sponsor can ring their guest and can also just open the room.
    expect(rows[2]).toHaveTextContent('Call')
    expect(rows[2]).toHaveTextContent('Open room')
  })

  it('an expired guest with own minutes can still Call', () => {
    card(true)
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Call')
  })

  it('Call rings, then follows the answer to the lobby', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'ringing',
          sessionId: SESSION,
          meetingId: MEETING,
          expiresAt: inFuture(30),
        }),
      ),
    )
    card(false)
    fireEvent.click(screen.getAllByRole('button', { name: /Call/ })[0]!)
    expect(await screen.findByText('Calling Sponsor')).toBeInTheDocument()
    act(() =>
      channelHandlers.call_answered!({
        payload: { sessionId: SESSION, meetingId: MEETING, outcome: 'accepted' },
      }),
    )
    expect(push).toHaveBeenCalledWith(`/m/${MEETING}/lobby`)
  })

  it('cancels after 30 s without an answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'ringing',
          sessionId: SESSION,
          meetingId: MEETING,
          expiresAt: inFuture(1),
        }),
      ),
    )
    card(false)
    fireEvent.click(screen.getAllByRole('button', { name: /Call/ })[0]!)
    expect(await screen.findByText('Calling Sponsor')).toBeInTheDocument()
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(`/api/calls/${SESSION}/cancel`, { method: 'POST' }),
      { timeout: 3000 },
    )
    expect(await screen.findByText('Sponsor did not answer.')).toBeInTheDocument()
  })
})
