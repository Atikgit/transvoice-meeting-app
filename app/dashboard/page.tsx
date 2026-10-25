import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ConnectionItem } from '@/components/calls/connections-card'
import { DashboardHome } from '@/components/dashboard/dashboard-home'
import { currentBalance } from '@/lib/auth/account'
import { availableMinutes, canSpendMinutes } from '@/lib/billing/balance'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const [{ data: profile }, account, { data: sponsorships }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    currentBalance(user.id),
    // RLS: rows where I am sponsor or guest.
    supabase
      .from('sponsored_connections')
      .select('meeting_id, sponsor_id, guest_id, expires_at')
      .is('revoked_at', null)
      .order('expires_at', { ascending: false })
      .limit(20),
  ])
  const otherIds = [
    ...new Set(
      (sponsorships ?? []).map((s) => (s.sponsor_id === user.id ? s.guest_id : s.sponsor_id)),
    ),
  ]
  const { data: people } = otherIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', otherIds)
    : { data: [] }
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name || 'Partner']))
  const seen = new Set<string>()
  const connections: ConnectionItem[] = []
  for (const s of sponsorships ?? []) {
    const role = s.sponsor_id === user.id ? 'sponsor' : 'guest'
    const key = `${s.meeting_id}-${role}`
    if (seen.has(key)) continue
    seen.add(key)
    connections.push({
      meetingId: s.meeting_id,
      role,
      name: nameOf.get(role === 'sponsor' ? s.guest_id : s.sponsor_id) ?? 'Partner',
      expiresAt: s.expires_at,
    })
  }

  const name = profile?.full_name || user.email?.split('@')[0] || 'there'

  return (
    <DashboardHome
      userId={user.id}
      greeting={`Welcome back, ${name}`}
      balance={account ? availableMinutes(account) : 0}
      canSpend={canSpendMinutes(account)}
      connections={connections}
    />
  )
}
