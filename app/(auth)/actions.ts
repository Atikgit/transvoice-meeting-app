'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { enabledProviders, type OAuthProvider } from '@/lib/auth/providers'
import { safeNextPath } from '@/lib/auth/redirect'
import { clientIp, requestOrigin } from '@/lib/http/request'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export interface AuthFormState {
  error?: string
  notice?: string
  email?: string
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

const RATE_LIMITED = 'Too many attempts. Please wait a few minutes and try again.'

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form.'
}

function callbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`
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
  if (error) {
    const message =
      error.code === 'email_not_confirmed'
        ? 'Please confirm your email first. Check your inbox for the link.'
        : 'Email or password is incorrect.'
    return { error: message, email: typedEmail }
  }

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
      emailRedirectTo: callbackUrl(await requestOrigin(), next),
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
    options: { redirectTo: callbackUrl(await requestOrigin(), next) },
  })
  if (error || !data.url) redirect('/login?error=provider')
  redirect(data.url)
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
