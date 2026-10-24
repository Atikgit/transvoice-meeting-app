'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, PhoneOff } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { secondsUntil, useUserChannel } from '@/features/calls/useUserChannel'

interface IncomingCall {
  sessionId: string
  meetingId: string
  callerName: string
  expiresAt: string
}

/**
 * Rings for calls to me (Rule 3): the sponsor sees who is calling and accepts or declines.
 * The call is missed after 30 s.
 */
export function IncomingCallListener({ userId }: { userId: string }) {
  const router = useRouter()
  const [call, setCall] = useState<IncomingCall | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useUserChannel(userId, {
    incoming_call: (payload) => {
      setError(undefined)
      setCall(payload)
    },
    call_cancelled: ({ sessionId }) => setCall((c) => (c?.sessionId === sessionId ? null : c)),
  })

  // A call that started ringing before this page opened.
  useEffect(() => {
    void fetch('/api/calls/incoming', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { calls: [] }))
      .then(({ calls }: { calls: IncomingCall[] }) => {
        if (calls[0]) setCall(calls[0])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!call) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [call])

  const left = call ? secondsUntil(call.expiresAt, now) : 0
  if (!call || left === 0) return null

  const answer = async (accept: boolean) => {
    setBusy(true)
    const res = await fetch(`/api/calls/${call.sessionId}/${accept ? 'accept' : 'decline'}`, {
      method: 'POST',
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) as { redirect?: string; error?: string }
    setBusy(false)
    if (res?.ok && body.redirect) return router.push(body.redirect)
    if (res?.ok) return setCall(null)
    setError(body.error ?? 'Could not answer the call.')
  }

  return (
    <Modal title="Incoming call" onClose={() => void answer(false)}>
      <div role="alertdialog" aria-labelledby="incoming-caller" className="text-center">
        <div className="mx-auto flex size-16 animate-pulse items-center justify-center rounded-full bg-cyan-300/15 text-cyan-300">
          <Phone size={28} aria-hidden />
        </div>
        <p id="incoming-caller" className="mt-4 text-lg font-semibold text-white">
          {call.callerName} is calling
        </p>
        <p className="mt-1 text-sm text-slate-400">
          The call is billed to your minutes while you sponsor them. Missed in {left} s.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="danger" disabled={busy} onClick={() => void answer(false)}>
            <PhoneOff size={15} /> Decline
          </Button>
          <Button disabled={busy} onClick={() => void answer(true)}>
            <Phone size={15} /> Accept
          </Button>
        </div>
      </div>
    </Modal>
  )
}
