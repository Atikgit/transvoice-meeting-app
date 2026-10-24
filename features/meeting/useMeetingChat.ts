'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from './types'

/**
 * Meeting chat over Supabase Realtime broadcast (free, Rule 6; independent of LiveKit so it
 * keeps working when media is down). Channel: chat:<meetings.room_name> (random per meeting).
 * Phase 6 persists messages and moves this to a private channel with RLS.
 */
export function useMeetingChat({ roomName, myName }: { roomName: string; myName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`chat:${roomName}`, { config: { broadcast: { self: false } } })
    channelRef.current = channel
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const message = payload as ChatMessage
        if (typeof message?.text === 'string') setMessages((prev) => [...prev, message])
      })
      .subscribe()
    return () => {
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [roomName])

  const send = async (text: string) => {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      sender: myName,
      text: text.slice(0, 4000),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages((prev) => [...prev, message])
    await channelRef.current?.send({ type: 'broadcast', event: 'message', payload: message })
  }

  return { messages, send }
}
