'use client'

import { useState, type FormEvent } from 'react'
import { Send, X } from 'lucide-react'
import { Button } from '@/components/common/button'
import type { ChatMessage } from '@/features/meeting/types'

export function ChatPanel({
  messages,
  myDisplayName,
  partnerConnected,
  onSend,
  onClose,
}: {
  messages: ChatMessage[]
  myDisplayName: string
  partnerConnected: boolean
  onSend: (text: string) => Promise<void>
  onClose: () => void
}) {
  const [chatInput, setChatInput] = useState('')

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    await onSend(chatInput)
    setChatInput('')
  }

  return (
    <aside className="flex flex-col w-full border-l border-white/[.08] bg-[#10131d] p-5 lg:w-[340px]">
      <div className="flex justify-between items-center pb-4 border-b border-white/[.08]">
        <div>
          <h2 className="font-semibold text-white text-sm">Meeting Chat</h2>
          <p className="text-[11px] text-slate-500">
            {partnerConnected ? '2 participants' : 'Only you'}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className="rounded-xl border border-white/5 bg-white/[.02] p-3 text-xs">
            <div className="flex justify-between text-slate-500 mb-1">
              <span
                className={`font-semibold ${m.sender === myDisplayName ? 'text-cyan-300' : 'text-indigo-300'}`}
              >
                {m.sender}
              </span>
              <span>{m.time}</span>
            </div>
            <p className="text-slate-200">{m.text}</p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSendMessage} className="pt-3 border-t border-white/[.08] flex gap-2">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Message everyone..."
          className="flex-1 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-300"
        />
        <Button type="submit" aria-label="Send message" className="px-3 py-2">
          <Send size={14} />
        </Button>
      </form>
    </aside>
  )
}
