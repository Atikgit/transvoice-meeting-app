'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { PricingModal } from '@/components/billing/pricing-modal'
import { Dashboard } from '@/components/dashboard/dashboard'
import { InviteModal } from '@/components/invite/invite-modal'
import { JoinScreen } from '@/components/join/join-screen'
import { Meeting } from '@/components/meeting/meeting'
import { availableMinutes } from '@/lib/supabase/database.types'
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
  const [modal, setModal] = useState<'invite' | 'pricing' | null>(null)
  const [roomId, setRoomId] = useState(initialRoomId)
  const [srcLang, setSrcLang] = useState('en-US')
  const [tgtLang, setTgtLang] = useState('bn-BD')
  const [guestName, setGuestName] = useState('Guest Partner')
  const [user, setUser] = useState<User | null>(null)
  const [balance, setBalance] = useState<number>(0)

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser(data.user)
        supabase
          .from('billing_accounts')
          .select('trial_minutes_remaining, prepaid_minutes_remaining')
          .eq('user_id', data.user.id)
          .maybeSingle()
          .then(({ data: account }) => {
            if (account) setBalance(availableMinutes(account))
          })
      }
    })
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setBalance(0)
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
        onAuth={() => router.push('/login?next=/')}
        onPricing={() => setModal('pricing')}
        onSignOut={handleSignOut}
      />
      {modal === 'invite' && <InviteModal roomId={roomId} onClose={() => setModal(null)} />}
      {modal === 'pricing' && (
        <PricingModal userId={user?.id ?? null} balance={balance} onClose={() => setModal(null)} />
      )}
    </>
  )
}
