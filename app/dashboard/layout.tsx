import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/dashboard/app-header'
import { availableMinutes } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const { data: account } = await supabase
    .from('billing_accounts')
    .select(
      'billing_type, trial_minutes_remaining, prepaid_minutes_remaining, postpaid_minutes_accrued',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  const minutesLabel = !account
    ? '—'
    : account.billing_type === 'postpaid'
      ? `${Number(account.postpaid_minutes_accrued).toFixed(0)} min used this period`
      : `${availableMinutes(account).toFixed(0)} min remaining`

  return (
    <div className="min-h-screen bg-[#0b0e16] text-slate-100">
      <AppHeader minutesLabel={minutesLabel} />
      {children}
    </div>
  )
}
