'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { resendConfirmation, signIn, type AuthFormState } from '@/app/(auth)/actions'
import { FormMessage, inputClass } from '@/components/auth/auth-card'

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, {
    error: initialError,
  })

  return (
    <>
      <form action={action} className="space-y-3">
        {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="sr-only">Email address</span>
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Email address"
            defaultValue={state.email}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="sr-only">Password</span>
          <input
            required
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            className={inputClass}
          />
        </label>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
          >
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {state.unconfirmed && state.email && (
        <ResendConfirmation key={state.email} email={state.email} next={next} />
      )}
    </>
  )
}

function ResendConfirmation({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resendConfirmation, {})

  return (
    <form action={action} className="mt-3">
      {state.notice && <FormMessage tone="notice">{state.notice}</FormMessage>}
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[.09] disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Resend confirmation email'}
      </button>
    </form>
  )
}
