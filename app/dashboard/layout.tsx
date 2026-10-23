import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/dashboard/app-header'
import { currentBalance } from '@/lib/auth/account'
import { minutesLabel } from '@/lib/billing/balance'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const balance = await currentBalance(user.id)

  return (
    <div className="min-h-screen bg-[#0b0e16] text-slate-100">
      <AppHeader minutesLabel={minutesLabel(balance)} />
      {children}
    </div>
  )
}
