// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PricingModal } from '@/components/billing/pricing-modal'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { joinPathFromLink } from '@/components/dashboard/join-link-modal'
import { UserManual } from '@/components/dashboard/user-manual'
import { appendCaption, CaptionBar } from '@/components/meeting/caption-bar'
import { ControlBar } from '@/components/meeting/control-bar'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { VideoTile } from '@/components/meeting/video-tile'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const noop = () => {}

afterEach(cleanup)

describe('Dashboard overview', () => {
  it('greets the user and shows the minutes card', () => {
    render(
      <DashboardOverview
        greeting="Welcome back, Atik"
        balance={15}
        onMeeting={noop}
        onPricing={noop}
        onJoin={noop}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Welcome back, Atik' })).toBeInTheDocument()
    expect(screen.getByText('Translation minutes')).toBeInTheDocument()
  })
})

describe('PricingModal', () => {
  it('lists the three Lemon Squeezy plans', () => {
    render(<PricingModal userId={null} balance={15} onClose={noop} />)
    for (const name of ['Bronze Starter', 'Diamond Pro', 'Business Standard']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })
})

describe('Meeting pieces', () => {
  it('keeps only the latest caption text', () => {
    expect(appendCaption('', ' Hello ')).toBe('Hello')
    expect(appendCaption('Hello', 'world')).toBe('Hello world')
    expect(appendCaption('a'.repeat(400), 'new words', 20)).toBe('aaaaaaaaaa new words')
  })

  it('shows the placeholder before any caption', () => {
    render(<CaptionBar translating={false} originalText="" translatedText="" placeholder="Soon" />)
    expect(screen.getByText('Soon')).toBeInTheDocument()
  })

  it('shows live captions', () => {
    render(<CaptionBar translating originalText="হ্যালো" translatedText="Hello" />)
    expect(screen.getByText('Translating live...')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  const controls = (props: Partial<Parameters<typeof ControlBar>[0]> = {}) => {
    const handlers = { onLeave: vi.fn(), onStart: vi.fn(), onEnd: vi.fn() }
    render(
      <ControlBar
        mic
        camera={false}
        unreadCount={2}
        role="host"
        live={false}
        onToggleMic={noop}
        onToggleCamera={noop}
        onInvite={noop}
        onToggleChat={noop}
        {...handlers}
        {...props}
      />,
    )
    return handlers
  }

  it('wires control bar actions and unread badge', () => {
    const { onLeave } = controls()
    expect(screen.getByText('2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Leave/ }))
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('host: Start while ready, End meeting once live', () => {
    const { onStart } = controls()
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }))
    expect(onStart).toHaveBeenCalledOnce()
    cleanup()
    const { onEnd } = controls({ live: true })
    expect(screen.queryByRole('button', { name: /^Start$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /End meeting/ }))
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('guest: waits for the host, then has no Start/End', () => {
    controls({ role: 'guest' })
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for host to start…')
    expect(screen.queryByRole('button', { name: /^Start$|End meeting/ })).toBeNull()
    cleanup()
    controls({ role: 'guest', live: true })
    expect(screen.queryByText('Waiting for host to start…')).toBeNull()
  })
})

describe('Dashboard actions', () => {
  it('has Join with link and Start meeting, and no Invite Partner (that lives in the room)', () => {
    render(
      <DashboardOverview
        greeting="Hi"
        balance={15}
        onMeeting={noop}
        onJoin={noop}
        onPricing={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /Join with link/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start meeting/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Invite Partner|Get minutes to invite/ }),
    ).toBeNull()
    expect(screen.queryByText(/always opens a new/)).toBeNull()
  })

  it('works the same at 0 minutes: the minutes card still offers the plans', () => {
    const onPricing = vi.fn()
    render(
      <DashboardOverview
        greeting="Hi"
        balance={0}
        onMeeting={noop}
        onJoin={noop}
        onPricing={onPricing}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /View plans/ }))
    expect(onPricing).toHaveBeenCalled()
  })
})

describe('User manual', () => {
  it('lists the six steps and collapses on mobile', () => {
    render(<UserManual />)
    expect(
      screen.getByRole('heading', {
        name: /User Manual — How to start a meeting with your partner/,
      }),
    ).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /Show steps/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const list = screen.getByRole('list', { hidden: true })
    expect(list.className).toMatch(/\bhidden\b.*md:grid|md:grid.*\bhidden\b/)
    expect(list.querySelectorAll('li')).toHaveLength(6)
    expect(list).toHaveTextContent('signs up free (gets 15 free minutes)')
    expect(list).toHaveTextContent('Chat is always free.')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Join with link', () => {
  it.each([
    ['https://meet.transvoice.ai/invite/' + 'a'.repeat(43), '/invite/' + 'a'.repeat(43)],
    ['a'.repeat(43), '/invite/' + 'a'.repeat(43)],
    [
      'https://meet.transvoice.ai/m/11111111-1111-4111-8111-111111111111',
      '/m/11111111-1111-4111-8111-111111111111/lobby',
    ],
    // Pasted inside a message, with a query string, a trailing dot, or surrounding spaces.
    [
      'Join me here: https://meet.transvoice.ai/invite/' + 'a'.repeat(43) + ' thanks!',
      '/invite/' + 'a'.repeat(43),
    ],
    ['  meet.transvoice.ai/invite/' + 'b'.repeat(43) + '?utm=wa.', '/invite/' + 'b'.repeat(43)],
    ['https://meet.transvoice.ai/invite/' + 'c'.repeat(43) + '#x', '/invite/' + 'c'.repeat(43)],
    ['https://evil.example/phish', null],
    ['https://meet.transvoice.ai/invite/too-short', null],
    ['hello', null],
  ])('%s → %s', (input, path) => expect(joinPathFromLink(input)).toBe(path))
})

describe('Meeting header', () => {
  it('shows brand, meeting name, encrypted session and the status pill; never a stray dash', () => {
    const { container } = render(
      <MeetingHeader title="Weekly sync" status="live" statusLabel="Live 01:23" />,
    )
    expect(screen.getByText('TransVoice AI')).toBeInTheDocument()
    expect(screen.getByText('Weekly sync')).toBeInTheDocument()
    expect(screen.getByText('Encrypted session')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Live 01:23')
    expect(container.textContent).not.toContain('—')
  })
})

describe('Video tile indicators', () => {
  it('shows mute, connection quality, speaking ring and the camera-off avatar', () => {
    const { container } = render(
      <VideoTile
        name="Rahim"
        initials="RA"
        color="bg-teal-900/60"
        speaking
        micMuted
        quality="poor"
        label="Camera off"
      />,
    )
    expect(screen.getByLabelText('Microphone muted')).toBeInTheDocument()
    expect(screen.getByLabelText('Poor connection')).toBeInTheDocument()
    expect(screen.getByText('RA')).toBeInTheDocument()
    expect(screen.getByText('Camera off')).toBeInTheDocument()
    expect(container.querySelector('[data-speaking]')).not.toBeNull()
  })

  it('renders the video instead of the avatar when there is one', () => {
    render(<VideoTile name="Rahim" initials="RA" color="x" video={<video data-testid="v" />} />)
    expect(screen.getByTestId('v')).toBeInTheDocument()
    expect(screen.queryByText('RA')).toBeNull()
  })
})
