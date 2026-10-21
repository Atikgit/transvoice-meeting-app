import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthCard } from '@/components/auth/auth-card'
import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { SignupForm } from '@/components/auth/signup-form'
import { enabledProviders } from '@/lib/auth/providers'
import { safeNextPath, withNext } from '@/lib/auth/redirect'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'

export const metadata: Metadata = { title: 'Create account · TransVoice' }

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const next = safeNextPath((await searchParams).next)

  return (
    <AuthCard
      title="Create your account"
      subtitle={`Includes ${FREE_TRIAL_MINUTES} free minutes of live voice translation once you verify your email.`}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={withNext('/login', next)}
            className="font-medium text-cyan-300 hover:text-cyan-200"
          >
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons providers={enabledProviders()} next={next} />
      <SignupForm next={next} />
    </AuthCard>
  )
}
