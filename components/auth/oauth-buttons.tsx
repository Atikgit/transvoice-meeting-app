import { signInWithProvider } from '@/app/(auth)/actions'
import type { OAuthProvider } from '@/lib/auth/providers'

const LABELS: Record<OAuthProvider, string> = {
  google: 'Continue with Google',
  linkedin_oidc: 'Continue with LinkedIn',
}

function ProviderIcon({ provider }: { provider: OAuthProvider }) {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#0A66C2"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"
      />
    </svg>
  )
}

/** One form per provider so it works without JavaScript. Renders nothing if none are enabled. */
export function OAuthButtons({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  if (providers.length === 0) return null
  return (
    <>
      <div className="grid gap-3">
        {providers.map((provider) => (
          <form key={provider} action={signInWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[.09]"
            >
              <ProviderIcon provider={provider} />
              {LABELS[provider]}
            </button>
          </form>
        ))}
      </div>
      <div className="relative my-6 flex items-center justify-center">
        <div className="w-full border-t border-white/10" />
        <span className="absolute bg-[#151b29] px-3 text-xs uppercase tracking-wider text-slate-500">
          or use email
        </span>
      </div>
    </>
  )
}
