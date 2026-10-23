'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PricingModal } from '@/components/billing/pricing-modal'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { InviteModal } from '@/components/invite/invite-modal'

/** Client part of /dashboard. Meetings still open in the legacy `/` shell until Phase 2. */
export function DashboardHome({
  userId,
  greeting,
  balance,
  canInvite,
}: {
  userId: string
  greeting: string
  balance: number
  canInvite: boolean
}) {
  const router = useRouter()
  const [pricing, setPricing] = useState(false)
  const [inviting, setInviting] = useState(false)

  return (
    <>
      <DashboardOverview
        greeting={greeting}
        balance={balance}
        onMeeting={() => router.push('/?view=meeting')}
        onJoin={() => router.push('/?view=join')}
        onPricing={() => setPricing(true)}
        canInvite={canInvite}
        onInvite={() => setInviting(true)}
      />
      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onNoMinutes={() => {
            setInviting(false)
            setPricing(true)
          }}
        />
      )}
      {pricing && (
        <PricingModal userId={userId} balance={balance} onClose={() => setPricing(false)} />
      )}
    </>
  )
}
