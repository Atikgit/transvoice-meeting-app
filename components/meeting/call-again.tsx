'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Phone } from 'lucide-react'
import { Button } from '@/components/common/button'
import { useUserChannel } from '@/features/calls/useUserChannel'

/**
 * "Call again" after a lost session (Rule 5). Uses the normal call rights (Rule 3): the host and
 * anyone with an open session go to the lobby, a sponsored guest rings the sponsor, an expired
 * guest without minutes gets Subscribe / Message.
 */
export function CallAgain({ meetingId, userId }: { meetingId: string; userId: string }) {
  const router = useRouter()
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'ringing'; sessionId: string }
    | { kind: 'error'; error: string; noMinutes?: boolean }
  >({ kind: 'idle' })

  useUserChannel(userId, {
    call_answered: ({ sessionId, meetingId: target, outcome }) => {
      if (state.kind !== 'ringing' || state.sessionId !== sessionId) return
      if (outcome === 'accepted') router.push(`/m/${target}/lobby`)
      else setState({ kind: 'error', error: 'The host declined the call.' })
    },
  })

  const call = async () => {
    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) as {
      redirect?: string
      mode?: string
      sessionId?: string
      error?: string
      code?: string
    }
    if (res?.ok && body.redirect) return router.push(body.redirect)
    if (res?.ok && body.mode === 'ringing' && body.sessionId) {
      return setState({ kind: 'ringing', sessionId: body.sessionId })
    }
    setState({
      kind: 'error',
      error: body.error ?? 'Could not call again.',
      noMinutes: body.code === 'NO_MINUTES',
    })
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {state.kind === 'ringing' ? (
        <p role="status" className="text-sm text-cyan-100">
          Calling the host… they have 30 seconds to accept.
        </p>
      ) : (
        <Button onClick={() => void call()}>
          <Phone size={15} /> Call again
        </Button>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-rose-300">
          {state.error}
          {state.noMinutes && (
            <>
              {' '}
              <Link href="/dashboard" className="underline">
                Subscribe
              </Link>{' '}
              ·{' '}
              <Link href={`/m/${meetingId}/chat`} className="underline">
                Message
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
