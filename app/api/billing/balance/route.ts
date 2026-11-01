import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { toBalanceView, type BalanceView, type NotPayerView } from '@/lib/billing/balance-view'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * GET /api/billing/balance[?sessionId=…] — the caller's own minutes: {trialMinutes,
 * subscriptionMinutes, plan, billingType, low}. The dashboard calls it without a session. The room
 * passes its session: only someone who pays for a participant of that session gets numbers
 * ({payer: true, …}); everybody else, a sponsored guest above all, gets {payer: false} and no
 * balance at all.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('balance', user.id))) return new NextResponse(null, { status: 429 })

  const param = request.nextUrl.searchParams.get('sessionId')
  const sessionId = param === null ? null : z.uuid().safeParse(param)
  if (sessionId && !sessionId.success)
    return NextResponse.json({ error: 'Invalid sessionId.' }, { status: 400 })

  const admin = createAdminClient()
  if (sessionId?.success) {
    const { data, error } = await admin
      .from('meeting_participants')
      .select('user_id')
      .eq('session_id', sessionId.data)
      .eq('payer_id', user.id)
      .limit(1)
    if (error) return NextResponse.json({ error: 'Balance unavailable.' }, { status: 503 })
    if (!data || data.length === 0) {
      const none: NotPayerView = { payer: false }
      return NextResponse.json(none, { headers: noStore })
    }
  }

  const { data: account, error } = await admin
    .from('billing_accounts')
    .select(
      'billing_type, plan, trial_minutes_remaining, prepaid_minutes_remaining, postpaid_minutes_accrued, postpaid_credit_limit_minutes',
    )
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Balance unavailable.' }, { status: 503 })
  if (!account) return NextResponse.json({ error: 'No billing account.' }, { status: 404 })

  const view: BalanceView = {
    ...toBalanceView(account),
    ...(sessionId?.success ? { payer: true } : {}),
  }
  return NextResponse.json(view, { headers: noStore })
}
