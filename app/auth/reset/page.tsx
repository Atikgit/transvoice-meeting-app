import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthCard } from '@/components/auth/auth-card'
import { ResetPasswordForm } from '@/components/auth/password-forms'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Choose a new password' }

/**
 * Target of the password reset email. The recommended template opens a recovery session in
 * /auth/confirm first; the default template arrives here with a PKCE ?code, which only a route
 * handler can exchange (it sets cookies).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await searchParams
  if (typeof code === 'string' && code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}&next=/auth/reset`)
  }

  const user = await getSessionUser()

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={user?.email ? `For ${user.email}. Use at least 8 characters.` : undefined}
    >
      {user ? (
        <ResetPasswordForm />
      ) : (
        <p className="text-sm text-slate-400">
          This reset link is invalid or has expired.{' '}
          <Link href="/forgot-password" className="font-medium text-cyan-300 hover:text-cyan-200">
            Request a new link
          </Link>
          .
        </p>
      )}
    </AuthCard>
  )
}
