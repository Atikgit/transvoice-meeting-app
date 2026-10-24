'use client'

import { useActionState } from 'react'
import { requestPasswordReset, updatePassword, type AuthFormState } from '@/app/(auth)/actions'
import { FormMessage, inputClass } from '@/components/auth/auth-card'

const submitClass =
  'w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50'

export function ForgotPasswordForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, {
    error: initialError,
  })

  return (
    <form action={action} className="space-y-3">
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.notice && <FormMessage tone="notice">{state.notice}</FormMessage>}
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
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}

export function ResetPasswordForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(updatePassword, {})

  return (
    <form action={action} className="space-y-3">
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="sr-only">New password</span>
        <input
          required
          name="password"
          type="password"
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder="New password (at least 8 characters)"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="sr-only">Confirm new password</span>
        <input
          required
          name="confirm"
          type="password"
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder="Confirm new password"
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  )
}
