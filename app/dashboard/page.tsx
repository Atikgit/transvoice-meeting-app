import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DashboardHome } from '@/components/dashboard/dashboard-home'
import { availableMinutes } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard · TransVoice' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const [{ data: profile }, { data: account }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('billing_accounts')
      .select('trial_minutes_remaining, prepaid_minutes_remaining')
      .eq('user_id', user.id)
      .maybeSingle(),
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
