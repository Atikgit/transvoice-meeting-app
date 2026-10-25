'use client'

import { useEffect, useEffectEvent } from 'react'
import { reportDiag } from '@/features/translation/diag'
import { createClient } from '@/lib/supabase/client'

export interface UserChannelHandlers {
  incoming_call?: (payload: {
    sessionId: string
    meetingId: string
    callerName: string
    expiresAt: string
    fromHost: boolean
  }) => void
  call_cancelled?: (payload: { sessionId: string }) => void
  call_answered?: (payload: {
    sessionId: string
    meetingId: string
    outcome: 'accepted' | 'declined'
  }) => void
}

/** Re-subscribe delays after a channel error / timeout / close (ms), then it keeps trying every 30 s. */
export const RESUBSCRIBE_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000]

type AnyHandler = (event: keyof UserChannelHandlers, payload: unknown) => void

interface Hub {
  listeners: Set<AnyHandler>
  stop: () => void
}
const hubs = new Map<string, Hub>()

/**
 * ONE Realtime channel per user per page, shared by every component that listens for calls.
 * supabase-js hands out the same channel object for the same topic, so two components that each
 * subscribed (the dashboard's incoming-call modal and the connections card, or the room's
 * "Call again" next to the incoming-call modal) used to share one channel, and when either
 * unmounted it removed the channel under the other. The hub subscribes once, fans events out to
 * all listeners and unsubscribes when the last one leaves.
 *
 * It sets the access token before joining (private channels authorise with the user's JWT), and a
 * channel that errors, times out or closes is replaced after a growing delay. Status changes go to
 * the browser console (`[calls] channel SUBSCRIBED`) and failures to the server log (/api/diag).
 */
function joinHub(userId: string, listener: AnyHandler): () => void {
  let hub = hubs.get(userId)
  if (!hub) {
    const supabase = createClient()
    const listeners = new Set<AnyHandler>()
    let channel: ReturnType<typeof supabase.channel> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const connect = async () => {
      if (stopped) return
      await supabase.realtime.setAuth().catch(() => {})
      if (stopped) return
      const next = supabase.channel(`user:${userId}`, { config: { private: true } })
      for (const event of ['incoming_call', 'call_cancelled', 'call_answered'] as const) {
        next.on('broadcast', { event }, ({ payload }) => {
          console.debug(`[calls] ${event} received`)
          for (const l of listeners) l(event, payload)
        })
      }
      next.subscribe((status) => {
        console.debug(`[calls] channel ${status}`)
        if (status === 'SUBSCRIBED') {
          attempt = 0
          return
        }
        if (stopped || !['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return
        reportDiag({ type: 'realtime_status', detail: status })
        void supabase.removeChannel(next)
        const delay = RESUBSCRIBE_DELAYS_MS[Math.min(attempt++, RESUBSCRIBE_DELAYS_MS.length - 1)]!
        retry = setTimeout(() => void connect(), delay)
      })
      channel = next
    }
    void connect()

    hub = {
      listeners,
      stop: () => {
        stopped = true
        clearTimeout(retry)
        if (channel) void supabase.removeChannel(channel)
      },
    }
    hubs.set(userId, hub)
  }
  hub.listeners.add(listener)
  const joined = hub
  return () => {
    joined.listeners.delete(listener)
    if (joined.listeners.size === 0) {
      joined.stop()
      hubs.delete(userId)
    }
  }
}

/** Listens to my private channel user:<id> (calls ringing, cancelled, answered). */
export function useUserChannel(userId: string, handlers: UserChannelHandlers) {
  const dispatch = useEffectEvent((event: keyof UserChannelHandlers, payload: unknown) => {
    const handler = handlers[event] as ((p: unknown) => void) | undefined
    handler?.(payload)
  })
  useEffect(() => joinHub(userId, dispatch), [userId])
}

/** Seconds left until `expiresAt` (ISO), ticking every second. */
export function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
}
