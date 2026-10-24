'use client'

import { useEffect, useEffectEvent } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface UserChannelHandlers {
  incoming_call?: (payload: {
    sessionId: string
    meetingId: string
    callerName: string
    expiresAt: string
  }) => void
  call_cancelled?: (payload: { sessionId: string }) => void
  call_answered?: (payload: {
    sessionId: string
    meetingId: string
    outcome: 'accepted' | 'declined'
  }) => void
}

/** Subscribes to my private Realtime channel user:<id> (only I can receive it, RLS). */
export function useUserChannel(userId: string, handlers: UserChannelHandlers) {
  const dispatch = useEffectEvent((event: keyof UserChannelHandlers, payload: unknown) => {
    const handler = handlers[event] as ((p: unknown) => void) | undefined
    handler?.(payload)
  })

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`user:${userId}`, { config: { private: true } })
    for (const event of ['incoming_call', 'call_cancelled', 'call_answered'] as const) {
      channel.on('broadcast', { event }, ({ payload }) => dispatch(event, payload))
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])
}

/** Seconds left until `expiresAt` (ISO), ticking every second. */
export function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
}
