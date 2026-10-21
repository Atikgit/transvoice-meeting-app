import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

interface LemonSqueezyWebhook {
  meta?: { event_name?: string; custom_data?: { user_id?: string } }
  data?: { attributes?: { first_order_item?: { product_name?: string; variant_name?: string } } }
}

/**
 * LEGACY (Phase 0: behaviour preserved). Phase 5 maps plans by variant_id and makes
 * crediting idempotent via payment_events (§2.1 #9).
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-signature')
    const secret = serverEnv().LEMONSQUEEZY_WEBHOOK_SECRET

    if (!signature || !secret) {
      return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 })
    }

    // Signature verification (HMAC SHA-256)
    const hmac = crypto.createHmac('sha256', secret)
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8')
    const signatureBuffer = Buffer.from(signature, 'utf8')

    if (
      digest.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(digest, signatureBuffer)
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody) as LemonSqueezyWebhook
    const eventName = payload.meta?.event_name
    const userId = payload.meta?.custom_data?.user_id // Supabase user id from the checkout link

    // Sent on successful payment or monthly renewal
    const validEvents = ['order_created', 'subscription_created', 'subscription_payment_success']

    if (eventName && validEvents.includes(eventName)) {
      const item = payload.data?.attributes?.first_order_item
      const productName = (item?.product_name || '').toLowerCase()
      const variantName = (item?.variant_name || '').toLowerCase()
      const combinedName = `${productName} ${variantName}`

      let purchasedMinutes = 120 // Starter (default)
      let planName = 'starter'

      if (combinedName.includes('pro') || combinedName.includes('diamond')) {
        purchasedMinutes = 300
        planName = 'pro'
      } else if (
        combinedName.includes('business') ||
        combinedName.includes('corporate') ||
        combinedName.includes('enterprise')
      ) {
        purchasedMinutes = 600
        planName = 'business'
      }

      if (userId) {
        const supabase = createAdminClient()
        await supabase.rpc('add_user_minutes', {
          p_user_id: userId,
          p_minutes: purchasedMinutes,
        })

        await supabase.from('profiles').update({ plan: planName }).eq('id', userId)

        console.log(
          `✅ User ${userId} successfully recharged with ${purchasedMinutes} minutes for plan ${planName}`,
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Webhook processing error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
