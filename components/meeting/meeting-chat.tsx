'use client'

import { BackButton } from '@/components/common/back-button'
import { Logo } from '@/components/common/logo'
import { ChatPanel } from '@/components/meeting/chat-panel'
import { useMeetingChat } from '@/features/meeting/useMeetingChat'

/** Chat-only page: messages are free and need no minutes. */
export function MeetingChat({ roomName, myName }: { roomName: string; myName: string }) {
  const chat = useMeetingChat({ roomName, myName })
  return (
    <main className="grid h-dvh grid-rows-[auto_1fr] bg-[#0b0e16] text-slate-100">
      <header className="flex h-[70px] items-center justify-between border-b border-white/[.08] px-5">
        <Logo />
        <BackButton />
      </header>
      <div className="mx-auto h-full min-h-0 w-full max-w-2xl p-4">
        <ChatPanel
          messages={chat.messages}
          myDisplayName={myName}
          partnerConnected={false}
          onSend={chat.send}
          onClose={() => history.back()}
        />
      </div>
    </main>
  )
}
