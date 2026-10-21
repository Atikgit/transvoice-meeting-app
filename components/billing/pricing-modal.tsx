'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { LEMON_SQUEEZY_PLANS } from '@/lib/billing/plans'

export function PricingModal({
  userId,
  balance,
  onClose,
}: {
  userId: string | null
  balance: number
  onClose: () => void
}) {
  const router = useRouter()
  const handleBuy = (checkoutUrl: string) => {
    if (!userId) {
      router.push('/login?next=/dashboard')
      return
    }
    // External Lemon Squeezy checkout, not an internal route. user_id comes back in the
    // webhook's meta.custom_data so the subscription is linked to this account.
    const url = new URL(checkoutUrl)
    url.searchParams.set('checkout[custom][user_id]', userId)
    window.location.assign(url.toString())
  }

  return (
    <Modal title="Plans & translation minutes" onClose={onClose} wide>
      <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.06] p-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-300">Available AI Translation</span>
          <strong className="text-cyan-200">{balance.toFixed(1)} mins remaining</strong>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {LEMON_SQUEEZY_PLANS.map((p, i) => (
          <div
            key={p.name}
            className={`rounded-2xl border p-4 ${i === 1 ? 'border-cyan-300/50 bg-cyan-300/[.07]' : 'border-white/10 bg-white/[.03]'}`}
          >
            <p className="text-sm font-semibold text-white">{p.name}</p>
            <p className="mt-3 text-2xl font-bold text-white">{p.price}</p>
            <p className="mt-3 text-sm text-cyan-200">{p.minutes}</p>
            <Button onClick={() => handleBuy(p.checkoutUrl)} className="mt-4 w-full text-xs">
              Choose plan
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
