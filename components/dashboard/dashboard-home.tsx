'use client'

import { useState, useTransition } from 'react'
import { createMeeting } from '@/app/m/actions'
import { PricingModal } from '@/components/billing/pricing-modal'
import { ConnectionsCard, type ConnectionItem } from '@/components/calls/connections-card'
import { DashboardOverview } from '@/components/dashboard/dashboard-overview'
import { JoinLinkModal } from '@/components/dashboard/join-link-modal'

/** Client part of /dashboard: meeting actions and their modals. */
export function DashboardHome({
  userId,
  greeting,
  balance,
  canSpend,
  connections = [],
}: {
  userId: string
  greeting: string
  balance: number
  /** The user has minutes to spend (ConnectionsCard: Call vs Subscribe). */
  canSpend: boolean
  connections?: ConnectionItem[]
}) {
  const [pricing, setPricing] = useState(false)
  const [joining, setJoining] = useState(false)
  const [creating, startCreating] = useTransition()
  const [error, setError] = useState<string>()

  // Start meeting → new meeting → its lobby (the action redirects).
  const startMeeting = () =>
    startCreating(async () => {
      const result = await createMeeting()
      if (result?.error) setError(result.error)
    })

  return (
    <>
      <DashboardOverview
        greeting={greeting}
        balance={balance}
        onMeeting={startMeeting}
        startingMeeting={creating}
        onJoin={() => setJoining(true)}
        onPricing={() => setPricing(true)}
      >
        <ConnectionsCard
          userId={userId}
          connections={connections}
          canSpend={canSpend}
          onSubscribe={() => setPricing(true)}
        />
      </DashboardOverview>
      {error && (
        <p role="alert" className="mx-auto max-w-6xl px-5 text-sm text-rose-300 lg:px-10">
          {error}
        </p>
      )}
      {joining && <JoinLinkModal onClose={() => setJoining(false)} />}
      {pricing && (
        <PricingModal userId={userId} balance={balance} onClose={() => setPricing(false)} />
      )}
    </>
  )
}
