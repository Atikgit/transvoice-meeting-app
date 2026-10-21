'use client'

import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'

// Legacy guessable link; replaced by hashed, expiring /invite/[token] links in Phase 2.
export function InviteModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link =
    typeof window !== 'undefined' ? `${window.location.origin}/?room=${roomId}&view=join` : ''

  return (
    <Modal title="Invite participant" onClose={onClose}>
      <p className="text-sm text-slate-400">Send this link to your partner to join this room.</p>
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-2">
        <Link2 size={16} className="ml-2 text-cyan-300" />
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-slate-300">{link}</span>
        <Button
          onClick={() => {
            navigator.clipboard?.writeText(link)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          className="shrink-0 px-3 py-2 text-xs"
        >
          {copied ? (
            <>
              <Check size={14} />
              Copied!
            </>
          ) : (
            'Copy link'
          )}
        </Button>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Your partner signs up or signs in to join, on mobile or PC. New accounts get 15 free
        minutes.
      </p>
    </Modal>
  )
}
