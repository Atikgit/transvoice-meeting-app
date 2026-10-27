'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellOff, Phone, PhoneOff } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { useCallSoundsMuted, useUnlockCallSounds } from '@/components/calls/enable-call-sounds'
import { startCallAlerts } from '@/features/calls/call-alerts'
import { setCallSoundsMuted, startRingtone } from '@/features/calls/call-sounds'
import { secondsUntil, useUserChannel } from '@/features/calls/useUserChannel'

interface IncomingCall {
  sessionId: string
  meetingId: string
  callerName: string
  expiresAt: string
  /** The host is calling their guest (else a guest is calling their sponsor). */
  fromHost?: boolean
}

/** A ring that Realtime did not deliver is found by polling within this long. */
export const INCOMING_POLL_MS = 3000

/**
 * Rings for calls to me (Rule 3): the sponsor sees who is calling and accepts or declines.
 * The call is missed after 30 s.
 */
export function IncomingCallListener({
  userId,
  currentMeetingId,
}: {
  userId: string
  /** On a meeting's lobby / room page: a call for that very meeting is not shown (you are there). */
  currentMeetingId?: string
}) {
  const router = useRouter()
  const [call, setCall] = useState<IncomingCall | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useUserChannel(userId, {
    incoming_call: (payload) => {
      if (payload.meetingId === currentMeetingId) return
      setError(undefined)
      setCall(payload)
    },
    call_cancelled: ({ sessionId }) => setCall((c) => (c?.sessionId === sessionId ? null : c)),
  })

  // Calls that started ringing before this page opened, or whose Realtime event was lost:
  // asked once now and then every 3 s. Realtime stays the fast path; this is the guarantee.
  useEffect(() => {
    let alive = true
    const poll = () =>
      fetch('/api/calls/incoming', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { calls: [] }))
        .then(({ calls }: { calls: IncomingCall[] }) => {
          if (!alive) return
          const first = calls.find((c) => c.meetingId !== currentMeetingId)
          if (first) {
            setCall((current) => {
              if (current?.sessionId !== first.sessionId)
                console.debug('[calls] incoming call found by polling')
              // An expired ring that is still in state must not hide a new one.
              return current && secondsUntil(current.expiresAt, Date.now()) > 0 ? current : first
            })
          }
        })
        .catch(() => {})
    const first = setTimeout(() => void poll(), 0)
    const timer = setInterval(() => void poll(), INCOMING_POLL_MS)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [currentMeetingId])

  useEffect(() => {
    if (!call) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [call])

  const left = call ? secondsUntil(call.expiresAt, now) : 0
  const muted = useCallSoundsMuted()
  useUnlockCallSounds() // the first tap or key on any signed-in page lets the ringtone play

  // Rings (and flashes the tab, vibrates, notifies) exactly while the modal is open and not yet
  // answered: stops on accept, decline, a cancelled call and when the 30 s are over.
  const ringing = Boolean(call) && left > 0 && !busy
  const callerName = call?.callerName
  useEffect(() => {
    if (!ringing || !callerName) return
    const stopSound = startRingtone()
    const stopAlerts = startCallAlerts(callerName)
    return () => {
      stopSound()
      stopAlerts()
    }
  }, [ringing, callerName])

  if (!call || left === 0) return null

  const answer = async (accept: boolean) => {
    setBusy(true)
    const res = await fetch(`/api/calls/${call.sessionId}/${accept ? 'accept' : 'decline'}`, {
      method: 'POST',
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) as { redirect?: string; error?: string }
    setBusy(false)
    if (res?.ok) setCall(null) // the ring ends the moment the call is answered
    if (res?.ok && body.redirect) return router.push(body.redirect)
    if (res?.ok) return
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
          {call.fromHost
            ? `Accepting joins ${call.callerName}'s meeting.`
            : 'The call is billed to your minutes while you sponsor them.'}{' '}
          Missed in {left} s.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => setCallSoundsMuted(!muted)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500 underline hover:text-slate-300"
        >
          <BellOff size={12} aria-hidden /> {muted ? 'Unmute ringtone' : 'Mute ringtone'}
        </button>
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
