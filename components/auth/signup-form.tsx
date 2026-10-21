'use client'

import { useActionState } from 'react'
import { signUp, type AuthFormState } from '@/app/(auth)/actions'
import { FormMessage, inputClass } from '@/components/auth/auth-card'

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {})

  if (state.notice) return <FormMessage tone="notice">{state.notice}</FormMessage>

  return (
    <form action={action} className="space-y-3">
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="sr-only">Full name</span>
        <input
          required
          name="full_name"
          autoComplete="name"
          maxLength={120}
          placeholder="Full name"
          className={inputClass}
        />
      </label>
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
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          placeholder="Password (8+ characters)"
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
      >
        {pending ? 'Creating account…' : 'Create free account'}
      </button>
    </form>
  )
}
