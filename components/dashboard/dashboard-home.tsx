'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PricingModal } from '@/components/billing/pricing-modal'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'

/** Client part of /dashboard. Meetings still open in the legacy `/` shell until Phase 2. */
export function DashboardHome({
  userId,
  greeting,
  balance,
}: {
  userId: string
  greeting: string
  balance: number
}) {
  const router = useRouter()
  const [pricing, setPricing] = useState(false)

  return (
    <>
      <DashboardOverview
        greeting={greeting}
        balance={balance}
        onMeeting={() => router.push('/?view=meeting')}
        onJoin={() => router.push('/?view=join')}
        onPricing={() => setPricing(true)}
      />
      {pricing && (
        <PricingModal userId={userId} balance={balance} onClose={() => setPricing(false)} />
      )}
    </>
  )
}
