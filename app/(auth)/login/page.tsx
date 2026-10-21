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
  confirm: 'That confirmation link is invalid or has expired. Sign in to get a new one.',
  provider: 'That sign-in method is not available right now.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const error = typeof params.error === 'string' ? ERRORS[params.error] : undefined

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
      <LoginForm next={next} initialError={error} />
    </AuthCard>
  )
}
