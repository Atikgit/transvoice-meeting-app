'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { createClient } from '@/lib/supabase/client'

export function AuthModal({ onClose }: { onClose: () => void }) {
  const [signup, setSignup] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const supabase = createClient()

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg('')
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) throw error
        setMsg('Account created! 15 minutes added.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
      setTimeout(() => {
        onClose()
        window.location.reload()
      }, 1000)
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={signup ? 'Create your account' : 'Welcome back'} onClose={onClose}>
      <div className="mb-5 flex rounded-xl bg-white/[.05] p-1">
        <button
          onClick={() => setSignup(false)}
          className={`flex-1 rounded-lg py-2 text-sm ${!signup ? 'bg-white/10 text-white' : 'text-slate-500'}`}
        >
          Sign in
        </button>
        <button
          onClick={() => setSignup(true)}
          className={`flex-1 rounded-lg py-2 text-sm ${signup ? 'bg-white/10 text-white' : 'text-slate-500'}`}
        >
          Create account
        </button>
      </div>
      {msg && (
        <p className="mb-3 rounded-lg bg-cyan-950 p-2 text-center text-xs text-cyan-200">{msg}</p>
      )}
      <form onSubmit={handleAuth} className="space-y-3">
        {signup && (
          <input
            required
            className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
        <input
          required
          className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none"
          placeholder="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          required
          className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button disabled={loading} className="w-full">
          {loading ? 'Please wait...' : signup ? 'Create free account' : 'Sign in'}
        </Button>
      </form>
    </Modal>
  )
}
