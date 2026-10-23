import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DashboardHome } from '@/components/dashboard/dashboard-home'
import { currentBalance } from '@/lib/auth/account'
import { availableMinutes } from '@/lib/billing/balance'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard · TransVoice' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const [{ data: profile }, account] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    currentBalance(user.id),
  ])

  const name = profile?.full_name || user.email?.split('@')[0] || 'there'

  return (
    <DashboardHome
      userId={user.id}
      greeting={`Welcome back, ${name}`}
      balance={account ? availableMinutes(account) : 0}
    />
  )
}
