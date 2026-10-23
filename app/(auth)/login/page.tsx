import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'
import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { enabledProviders } from '@/lib/auth/providers'
import { safeNextPath, withNext } from '@/lib/auth/redirect'

export const metadata: Metadata = { title: 'Sign in · TransVoice' }

const ERRORS: Record<string, string> = {
  callback: 'That sign-in link is invalid or has expired. Please try again.',
  confirm: 'That confirmation link is invalid. Sign in, or request a new link below.',
  link_expired:
    'Link expired — resend the confirmation email below. If you already confirmed, just sign in.',
  provider: 'That sign-in method is not available right now.',
}

const NOTICES: Record<string, string> = {
  already_confirmed: 'This link was already used: your email is confirmed. Sign in to continue.',
}

/** Errors that come with a "Resend confirmation email" form. */
const OFFER_RESEND = new Set(['link_expired', 'confirm'])

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const code = typeof params.error === 'string' ? params.error : undefined
  const error = code ? ERRORS[code] : undefined
  const notice = code ? NOTICES[code] : undefined

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to start or join a translated meeting."
      footer={
        <>
          New to TransVoice?{' '}
          <Link
            href={withNext('/signup', next)}
            className="font-medium text-cyan-300 hover:text-cyan-200"
          >
            Create a free account
          </Link>
        </>
      }
    >
      <OAuthButtons providers={enabledProviders()} next={next} />
      <LoginForm
        next={next}
        initialError={error}
        initialNotice={notice}
        offerResend={code ? OFFER_RESEND.has(code) : false}
      />
    </AuthCard>
  )
}
