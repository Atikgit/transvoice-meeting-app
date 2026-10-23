'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { EMAIL_FLOW_PARAM } from '@/lib/auth/link-errors'
import { rememberPendingNext } from '@/lib/auth/pending-next'
import { enabledProviders, type OAuthProvider } from '@/lib/auth/providers'
import { DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/auth/redirect'
import { appOrigin, clientIp } from '@/lib/http/request'
import { checkRateLimit, checkRateLimits } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export interface AuthFormState {
  error?: string
  notice?: string
  email?: string
  /** Sign-in failed because the email is not confirmed yet: offer to resend the link. */
  unconfirmed?: boolean
}

const email = z.email('Enter a valid email address.').max(254)
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')

const signInSchema = z.object({ email, password: z.string().min(1, 'Enter your password.') })
const signUpSchema = z.object({
  full_name: z.string().trim().min(1, 'Enter your name.').max(120),
  email,
  password,
})

const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: 'The passwords do not match.' })

const RATE_LIMITED = 'Too many attempts. Please wait a few minutes and try again.'

// Same text whether or not an account exists (no account enumeration).
const RESET_SENT =
  'If an account exists for that email, we have sent a link to reset your password. Check your inbox and spam folder.'
const CONFIRMATION_SENT =
  'If that email is waiting for confirmation, we have sent a new link. Check your inbox and spam folder.'

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form.'
}

function callbackUrl(origin: string, next: string, flow?: 'email'): string {
  const url = `${origin}/auth/callback?next=${encodeURIComponent(next)}`
  return flow ? `${url}&${EMAIL_FLOW_PARAM}=${flow}` : url
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  const typedEmail = String(formData.get('email') ?? '')
  if (!parsed.success) return { error: firstIssue(parsed.error), email: typedEmail }

  const ip = await clientIp()
  if (!(await checkRateLimit('login', `${ip}:${parsed.data.email.toLowerCase()}`))) {
    return { error: RATE_LIMITED, email: typedEmail }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error?.code === 'email_not_confirmed') {
    return {
      error: 'Your email is not confirmed yet. Open the link we emailed you, or send a new one.',
      email: typedEmail,
      unconfirmed: true,
    }
  }
  if (error) return { error: 'Email or password is incorrect.', email: typedEmail }

  redirect(safeNextPath(formData.get('next')))
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  const typedEmail = String(formData.get('email') ?? '')
  if (!parsed.success) return { error: firstIssue(parsed.error), email: typedEmail }

  if (!(await checkRateLimit('signup', await clientIp()))) {
    return { error: RATE_LIMITED, email: typedEmail }
  }

  const next = safeNextPath(formData.get('next'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: callbackUrl(await appOrigin(), next, 'email'),
    },
  })
  if (error) {
    return {
      error:
        error.code === 'weak_password'
          ? error.message
          : 'Could not create the account. Please try again.',
      email: typedEmail,
    }
  }

  // Email confirmation disabled in Supabase → already signed in.
  if (data.session) redirect(next)

  await rememberPendingNext(next)

  // Same message whether or not the address was already registered (no account enumeration).
  return {
    notice: `Check ${parsed.data.email} for a confirmation link. Your free minutes are added once you confirm.`,
  }
}

export async function signInWithProvider(formData: FormData): Promise<void> {
  const provider = formData.get('provider')
  const allowed = enabledProviders()
  if (typeof provider !== 'string' || !allowed.includes(provider as OAuthProvider)) {
    redirect('/login?error=provider')
  }

  const next = safeNextPath(formData.get('next'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as OAuthProvider,
    options: { redirectTo: callbackUrl(await appOrigin(), next) },
  })
  if (error || !data.url) redirect('/login?error=provider')
  redirect(data.url)
}

/** Rate limit keys for email-sending actions: per client IP and per address. */
async function emailLimitKeys(address: string): Promise<string[]> {
  return [`ip:${await clientIp()}`, `email:${address.toLowerCase()}`]
}

export async function resendConfirmation(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = email.safeParse(formData.get('email'))
  if (!parsed.success) return { error: firstIssue(parsed.error) }

  if (!(await checkRateLimits('resendConfirmation', await emailLimitKeys(parsed.data)))) {
    return { error: RATE_LIMITED }
  }

  await rememberPendingNext(safeNextPath(formData.get('next')))
  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: parsed.data,
    options: {
      emailRedirectTo: callbackUrl(await appOrigin(), safeNextPath(formData.get('next')), 'email'),
    },
  })
  if (error) console.error('auth.resend failed:', error.code ?? error.message)
  return { notice: CONFIRMATION_SENT }
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const typedEmail = String(formData.get('email') ?? '')
  const parsed = email.safeParse(formData.get('email'))
  if (!parsed.success) return { error: firstIssue(parsed.error), email: typedEmail }

  if (!(await checkRateLimits('passwordReset', await emailLimitKeys(parsed.data)))) {
    return { error: RATE_LIMITED, email: typedEmail }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await appOrigin()}/auth/reset`,
  })
  // Errors (unknown address, Supabase email limits) are logged, never shown.
  if (error) console.error('resetPasswordForEmail failed:', error.code ?? error.message)
  return { notice: RESET_SENT }
}

/** Sets a new password for the session opened by the reset link. */
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) return { error: firstIssue(parsed.error) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Your reset link has expired. Please request a new one.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return {
      error:
        error.code === 'same_password'
          ? 'Choose a password that is different from your current one.'
          : error.code === 'weak_password'
            ? error.message
            : 'Could not update the password. Please try again.',
    }
  }

  redirect(DEFAULT_AFTER_LOGIN)
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
