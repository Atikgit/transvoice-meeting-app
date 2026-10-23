// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PricingModal } from '@/components/billing/pricing-modal'
import { Dashboard } from '@/components/dashboard/dashboard'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { CaptionBar } from '@/components/meeting/caption-bar'
import { ControlBar } from '@/components/meeting/control-bar'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const noop = () => {}

afterEach(cleanup)

describe('Dashboard', () => {
  it('renders the guest workspace with the minutes card', () => {
    render(
      <Dashboard
        user={null}
        balance={15}
        onMeeting={noop}
        onAuth={noop}
        onPricing={noop}
        onJoin={noop}
        onInvite={noop}
        onSignOut={noop}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Good morning, Guest' })).toBeInTheDocument()
    expect(screen.getByText('15 min')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('greets a signed-in user by full name', () => {
    const user = {
      id: 'u1',
      email: 'a@b.co',
      user_metadata: { full_name: 'Atik' },
    } as unknown as User
    render(
      <Dashboard
        user={user}
        balance={120}
        onMeeting={noop}
        onAuth={noop}
        onPricing={noop}
        onJoin={noop}
        onInvite={noop}
        onSignOut={noop}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Welcome back, Atik' })).toBeInTheDocument()
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
  it('shows live captions', () => {
    render(<CaptionBar translating originalText="হ্যালো" translatedText="Hello" />)
    expect(screen.getByText('Translating live...')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('wires control bar actions and unread badge', () => {
    const onLeave = vi.fn()
    render(
      <ControlBar
        mic
        camera={false}
        unreadCount={2}
        onToggleMic={noop}
        onToggleCamera={noop}
        onInvite={noop}
        onToggleChat={noop}
        onLeave={onLeave}
      />,
    )
    expect(screen.getByTitle('Mute Mic')).toBeInTheDocument()
    expect(screen.getByTitle('Turn on camera')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Leave/ }))
    expect(onLeave).toHaveBeenCalledOnce()
  })
})

describe('Dashboard invite button', () => {
  const overview = (canInvite: boolean, onInvite = vi.fn(), onPricing = vi.fn()) => {
    render(
      <DashboardOverview
        greeting="Hi"
        balance={canInvite ? 15 : 0}
        canInvite={canInvite}
        onMeeting={noop}
        onJoin={noop}
        onPricing={onPricing}
        onInvite={onInvite}
      />,
    )
    return { onInvite, onPricing }
  }

  it('sits next to Join with link and Start meeting', () => {
    const { onInvite } = overview(true)
    fireEvent.click(screen.getByRole('button', { name: /Invite Partner/ }))
    expect(onInvite).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Join with link/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start meeting/ })).toBeInTheDocument()
  })

  it('becomes "Get minutes to invite" → pricing at 0 minutes', () => {
    const { onInvite, onPricing } = overview(false)
    expect(screen.queryByRole('button', { name: /Invite Partner/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Get minutes to invite/ }))
    expect(onPricing).toHaveBeenCalled()
    expect(onInvite).not.toHaveBeenCalled()
  })
})
