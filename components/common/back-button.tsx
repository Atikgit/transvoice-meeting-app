'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

/**
 * Goes back to the previous page of this site, or to `fallback` when the user arrived from
 * elsewhere (a shared link, a new tab).
 */
export function BackButton({ fallback = '/dashboard' }: { fallback?: string }) {
  const router = useRouter()

  const goBack = () => {
    let sameSite = false
    try {
      sameSite = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin
    } catch {
      sameSite = false
    }
    if (sameSite && window.history.length > 1) router.back()
    else router.push(fallback)
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
    >
      <ArrowLeft size={16} aria-hidden />
      Back
    </button>
  )
}
