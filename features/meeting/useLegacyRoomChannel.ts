'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage, SessionState, TranslationCaption } from './types'

/**
 * Supabase Realtime broadcast channel for partner presence, chat, translations and the host's
 * session state (Start / End meeting).
 * Legacy: Phase 2 moves presence to LiveKit, Phase 3 moves translations to LiveKit data
 * messages, Phase 6 persists chat.
 */
export function useLegacyRoomChannel({
  roomId,
  myDisplayName,
  onTranslation,
  onSessionState,
  onPeerJoined,
}: {
  roomId: string
  myDisplayName: string
  onTranslation: (caption: TranslationCaption) => void
  /** The host started or ended the meeting. */
  onSessionState?: (state: SessionState) => void
  /** Someone entered the room (the host re-sends the session state for late joiners). */
  onPeerJoined?: () => void
}) {
  const [partnerConnected, setPartnerConnected] = useState(false)
  const [partnerName, setPartnerName] = useState('Partner')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'initial-system-msg',
      sender: 'System',
      text: 'Encrypted meeting room established.',
      time: 'Now',
    },
  ])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const handleTranslation = useEffectEvent(onTranslation)
  const handleSessionState = useEffectEvent((state: SessionState) => onSessionState?.(state))
  const handlePeerJoined = useEffectEvent(() => onPeerJoined?.())

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`room_${roomId}`, {
      config: { broadcast: { self: false } },
    })
    channelRef.current = channel

    channel
      .on('broadcast', { event: 'user_joined' }, ({ payload }) => {
        setPartnerConnected(true)
        setPartnerName(payload.name || 'Partner')
        channel.send({
          type: 'broadcast',
          event: 'confirm_presence',
          payload: { name: myDisplayName },
        })
        handlePeerJoined()
      })
      .on('broadcast', { event: 'session_state' }, ({ payload }) => {
        handleSessionState(payload as SessionState)
      })
      .on('broadcast', { event: 'confirm_presence' }, ({ payload }) => {
        setPartnerConnected(true)
        setPartnerName(payload.name || 'Partner')
      })
      .on('broadcast', { event: 'new_chat' }, ({ payload }) => {
        setMessages((prev) => [...prev, payload.message])
      })
      .on('broadcast', { event: 'new_translation' }, ({ payload }) => {
        handleTranslation({
          original: payload.original,
          translated: payload.translated,
          audio: payload.audio,
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'user_joined',
            payload: { name: myDisplayName },
          })
        }
      })

    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [roomId, myDisplayName])

  const sendChat = async (text: string) => {
    const newMsg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sender: myDisplayName,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages((prev) => [...prev, newMsg])
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'new_chat',
      payload: { message: newMsg },
    })
  }

  const broadcastTranslation = (caption: TranslationCaption) => {
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'new_translation',
      payload: caption,
    })
  }

  const broadcastSessionState = (state: SessionState) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'session_state', payload: state })
  }

  return {
    partnerConnected,
    partnerName,
    messages,
    sendChat,
    broadcastTranslation,
    broadcastSessionState,
  }
}
