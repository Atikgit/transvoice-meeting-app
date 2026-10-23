import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthCard } from '@/components/auth/auth-card'
import { ForgotPasswordForm } from '@/components/auth/password-forms'

export const metadata: Metadata = { title: 'Reset password' }

const ERRORS: Record<string, string> = {
  link: 'That reset link is invalid or has expired. Request a new one below.',
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { error } = await searchParams

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we will send you a link to choose a new one."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/login" className="font-medium text-cyan-300 hover:text-cyan-200">
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm initialError={typeof error === 'string' ? ERRORS[error] : undefined} />
    </AuthCard>
  )
}
