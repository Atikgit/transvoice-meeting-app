'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, Phone, PhoneOff, Video, Wallet } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { secondsUntil, useUserChannel } from '@/features/calls/useUserChannel'

export interface ConnectionItem {
  meetingId: string
  name: string
  /** I invited them (I am the sponsor) or they invited me. */
  role: 'sponsor' | 'guest'
  expiresAt: string
}

type Ringing = { sessionId: string; name: string; expiresAt: string }

const linkClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[.09]'

/**
 * People you are connected with through invitations (Rule 3): sponsors open the room; guests
 * press Call (rings the sponsor). A guest whose window expired calls with their own minutes, or
 * sees only Subscribe / Message.
 */
export function ConnectionsCard({
  userId,
  connections,
  canSpend,
  onSubscribe,
}: {
  userId: string
  connections: ConnectionItem[]
  canSpend: boolean
  onSubscribe: () => void
}) {
  const router = useRouter()
  const [ringing, setRinging] = useState<Ringing | null>(null)
  const [notice, setNotice] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const cancelled = useRef(false)

  useUserChannel(userId, {
    call_answered: ({ sessionId, meetingId, outcome }) => {
      if (ringing?.sessionId !== sessionId) return
      setRinging(null)
      if (outcome === 'accepted') router.push(`/m/${meetingId}/lobby`)
      else setNotice(`${ringing.name} declined the call.`)
    },
  })

  const hangUp = async (reason: 'cancel' | 'timeout') => {
    if (!ringing || cancelled.current) return
    cancelled.current = true
    await fetch(`/api/calls/${ringing.sessionId}/cancel`, { method: 'POST' }).catch(() => {})
    setNotice(reason === 'timeout' ? `${ringing.name} did not answer.` : undefined)
    setRinging(null)
  }

  useEffect(() => {
    if (!ringing) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ringing])
  const left = ringing ? secondsUntil(ringing.expiresAt, now) : 0
  useEffect(() => {
    if (ringing && left === 0) void hangUp('timeout')
  })

  const call = async (item: ConnectionItem) => {
    setNotice(undefined)
    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: item.meetingId }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) as {
      mode?: string
      redirect?: string
      sessionId?: string
      expiresAt?: string
      error?: string
    }
    if (res?.ok && body.redirect) return router.push(body.redirect)
    if (res?.ok && body.mode === 'ringing' && body.sessionId && body.expiresAt) {
      cancelled.current = false
      return setRinging({ sessionId: body.sessionId, name: item.name, expiresAt: body.expiresAt })
    }
    setNotice(body.error ?? 'Could not start the call.')
  }

  if (connections.length === 0) return null

  return (
    <section
      aria-labelledby="connections-title"
      className="mt-10 rounded-2xl border border-white/10 bg-white/[.03] p-5"
    >
      <h2 id="connections-title" className="text-sm font-semibold text-white">
        Your connections
      </h2>
      {notice && (
        <p role="status" className="mt-3 text-sm text-amber-200">
          {notice}
        </p>
      )}
      <ul className="mt-4 divide-y divide-white/[.06]">
        {connections.map((item) => {
          const valid = Date.parse(item.expiresAt) > now
          const until = new Date(item.expiresAt).toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
          return (
            <li
              key={`${item.meetingId}-${item.role}`}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {item.role === 'sponsor' ? 'You sponsor this connection' : 'Sponsored by them'} ·{' '}
                  {valid ? `valid until ${until}` : `expired ${until}`}
                </p>
              </div>
              <div className="flex gap-2">
                {item.role === 'sponsor' ? (
                  <Link href={`/m/${item.meetingId}/lobby`} className={linkClass}>
                    <Video size={14} aria-hidden /> Open room
                  </Link>
                ) : valid || canSpend ? (
                  <Button className="px-3 py-2 text-xs" onClick={() => void call(item)}>
                    <Phone size={14} /> Call
                  </Button>
                ) : (
                  <>
                    <Button className="px-3 py-2 text-xs" onClick={onSubscribe}>
                      <Wallet size={14} /> Subscribe
                    </Button>
                    <Link href={`/m/${item.meetingId}/chat`} className={linkClass}>
                      <MessageCircle size={14} aria-hidden /> Message
                    </Link>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {ringing && left > 0 && (
        <Modal title="Calling…" onClose={() => void hangUp('cancel')}>
          <div className="text-center">
            <div className="mx-auto flex size-16 animate-pulse items-center justify-center rounded-full bg-cyan-300/15 text-cyan-300">
              <Phone size={28} aria-hidden />
            </div>
            <p className="mt-4 text-lg font-semibold text-white">Calling {ringing.name}</p>
            <p role="status" className="mt-1 text-sm text-slate-400">
              Waiting for them to accept · {left} s
            </p>
            <Button variant="danger" className="mt-6 w-full" onClick={() => void hangUp('cancel')}>
              <PhoneOff size={15} /> Cancel
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
