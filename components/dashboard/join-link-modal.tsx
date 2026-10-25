'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'

/** Path for a pasted invite or meeting link ("…/invite/<token>", "…/m/<id>/lobby"), or null. */
export function joinPathFromLink(input: string): string | null {
  const value = input.trim()
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) return `/invite/${value}`
  // A link pasted inside a message ("Join me: https://… Thanks!"): find the invite in the text.
  const embedded = /\/invite\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(value)
  if (embedded) return `/invite/${embedded[1]}`
  let path: string
  try {
    path = new URL(value, 'https://placeholder.invalid').pathname
  } catch {
    return null
  }
  const invite = /^\/invite\/([A-Za-z0-9_-]{43})\/?$/.exec(path)
  if (invite) return `/invite/${invite[1]}`
  const meeting = /^\/m\/([0-9a-f-]{36})(?:\/lobby)?\/?$/i.exec(path)
  if (meeting) return `/m/${meeting[1]}/lobby`
  return null
}

export function JoinLinkModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [link, setLink] = useState('')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const path = joinPathFromLink(link)
    if (!path) return setError('Paste the invitation link (or just its code) you received.')
    router.push(path)
  }

  return (
    <Modal title="Join with link" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">
            Paste the invitation link your partner sent you.
          </span>
          <input
            autoFocus
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
              setError(undefined)
            }}
            placeholder="https://meet.transvoice.ai/invite/…"
            aria-invalid={Boolean(error)}
            className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-300"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full">
          <Link2 size={15} /> Join
        </Button>
      </form>
    </Modal>
  )
}
