import { NextRequest, NextResponse } from 'next/server'
import { handleWebhook, parseWebhook, verifySignature } from '@/lib/billing/lemonsqueezy'
import { supabaseBillingStore } from '@/lib/billing/store'
import { serverEnv } from '@/lib/env'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  if (
    !verifySignature(
      rawBody,
      req.headers.get('x-signature'),
      serverEnv().LEMONSQUEEZY_WEBHOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event
  try {
    event = parseWebhook(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  try {
    const outcome = await handleWebhook(event, supabaseBillingStore())
    if (outcome.status === 'retry') {
      return NextResponse.json({ status: 'retry', reason: outcome.reason }, { status: 503 })
    }
    if (outcome.status === 'ignored') {
      console.info(`Lemon Squeezy ${event.meta.event_name} ignored: ${outcome.reason}`)
    }
    return NextResponse.json({ status: outcome.status })
  } catch (error) {
    console.error('Lemon Squeezy webhook failed:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
