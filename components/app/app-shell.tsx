'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { AuthModal } from '@/components/auth/auth-modal'
import { PricingModal } from '@/components/billing/pricing-modal'
import { Dashboard } from '@/components/dashboard/dashboard'
import { InviteModal } from '@/components/invite/invite-modal'
import { JoinScreen } from '@/components/join/join-screen'
import { Meeting } from '@/components/meeting/meeting'
import { createClient } from '@/lib/supabase/client'

export type Screen = 'dashboard' | 'meeting' | 'join'

// Single-page legacy shell. Phase 1–2 replace it with /dashboard, /invite/[token] and /m/[meetingId] routes.
export function AppShell({
  initialRoomId,
  initialScreen,
}: {
  initialRoomId: string
  initialScreen: Screen
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [modal, setModal] = useState<'invite' | 'auth' | 'pricing' | null>(null)
  const [roomId, setRoomId] = useState(initialRoomId)
  const [srcLang, setSrcLang] = useState('en-US')
  const [tgtLang, setTgtLang] = useState('bn-BD')
  const [guestName, setGuestName] = useState('Guest Partner')
  const [user, setUser] = useState<User | null>(null)
  const [balance, setBalance] = useState<number>(15)

  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser(data.user)
        supabase
          .from('profiles')
          .select('minutes_balance')
          .eq('id', data.user.id)
          .maybeSingle()
          .then(({ data: p }) => {
            if (p?.minutes_balance !== undefined) setBalance(Number(p.minutes_balance))
          })
      }
    })
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setBalance(15)
    window.location.reload()
  }

  const startMeeting = () => {
    const randomId = `room-${Math.random().toString(36).substring(2, 8)}`
    setRoomId(randomId)
    setScreen('meeting')
  }

  if (screen === 'join') {
    return (
      <JoinScreen
        onJoin={() => setScreen('meeting')}
        srcLang={srcLang}
        setSrcLang={setSrcLang}
        tgtLang={tgtLang}
        setTgtLang={setTgtLang}
        guestName={guestName}
        setGuestName={setGuestName}
      />
    )
  }

  if (screen === 'meeting') {
    return (
      <>
        <Meeting
          user={user}
          roomId={roomId}
          tgtLang={tgtLang}
          guestName={guestName}
          onInvite={() => setModal('invite')}
          onLeave={() => setScreen('dashboard')}
        />
        {modal === 'invite' && <InviteModal roomId={roomId} onClose={() => setModal(null)} />}
      </>
    )
  }

  return (
    <>
      <Dashboard
        user={user}
        balance={balance}
        onMeeting={startMeeting}
        onJoin={() => setScreen('join')}
        onAuth={() => setModal('auth')}
        onPricing={() => setModal('pricing')}
        onSignOut={handleSignOut}
      />
      {modal === 'invite' && <InviteModal roomId={roomId} onClose={() => setModal(null)} />}
      {modal === 'auth' && <AuthModal onClose={() => setModal(null)} />}
      {modal === 'pricing' && (
        <PricingModal user={user} balance={balance} onClose={() => setModal(null)} />
      )}
    </>
  )
}
