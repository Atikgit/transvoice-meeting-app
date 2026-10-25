'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Link2, Mail, MessageCircle, Send, Share2 } from 'lucide-react'
import {
  createInvitation,
  revokeInvitation,
  sendInvitationEmail,
  type CreateInvitationResult,
  type SendInviteEmailResult,
} from '@/app/invite/actions'
import { Button } from '@/components/common/button'
import { Modal } from '@/components/common/modal'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import {
  DEFAULT_INVITE_WINDOW,
  INVITE_WINDOWS,
  type InviteWindowId,
  shareLinks,
} from '@/lib/invitations/windows'
import { LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'

/** How many people may use one link (server limit: 1–100; default 20). */
const MAX_USES_OPTIONS = [1, 5, 20, 50, 100] as const
const DEFAULT_MAX_USES = 20

const shareClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[.09]'

/**
 * Invite Partner (Rule 1 / Rule 3): choose how long the link and the sponsorship stay valid,
 * create the link for `meetingId` (the meeting you are in), then share it.
 */
export function InviteModal({
  meetingId,
  onClose,
  onNoMinutes,
}: {
  /** The meeting the link is for; an invitation never creates a meeting. */
  meetingId: string
  onClose: () => void
  onNoMinutes?: () => void
}) {
  const [validity, setValidity] = useState<InviteWindowId>(DEFAULT_INVITE_WINDOW)
  const [result, setResult] = useState<CreateInvitationResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()
  const [maxUses, setMaxUses] = useState<number>(DEFAULT_MAX_USES)
  const [revoke, setRevoke] = useState<'idle' | 'revoking' | 'revoked' | { error: string }>('idle')

  const create = () =>
    startTransition(async () => {
      const created = await createInvitation({ window: validity, meetingId, maxUses })
      setResult(created)
      setRevoke('idle')
    })

  const revokeLink = (url: string) => {
    setRevoke('revoking')
    void revokeInvitation({ inviteUrl: url }).then((done) =>
      setRevoke(done.ok ? 'revoked' : { error: done.error }),
    )
  }

  if (result?.ok) {
    const links = shareLinks(result.url)
    const expires = new Date(result.expiresAt).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    return (
      <Modal title="Invite Partner" onClose={onClose}>
        <p className="text-sm text-slate-400">
          Share this link with your partner. Up to {maxUses} {maxUses === 1 ? 'person' : 'people'}{' '}
          can use it, and it can be opened again by the same person, until {expires}.
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-2">
          <Link2 size={16} className="ml-2 shrink-0 text-cyan-300" aria-hidden />
          <input
            readOnly
            aria-label="Invite link"
            value={result.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 truncate bg-transparent px-2 text-xs text-slate-300 outline-none"
          />
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(result.url)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
            className="shrink-0 px-3 py-2 text-xs"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={shareClass}>
            <MessageCircle size={14} aria-hidden /> WhatsApp
          </a>
          <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className={shareClass}>
            <Share2 size={14} aria-hidden /> LinkedIn
          </a>
          <a href={links.email} className={shareClass}>
            <Mail size={14} aria-hidden /> Email app
          </a>
        </div>
        <SendInviteEmail inviteUrl={result.url} />
        <div className="mt-3 text-xs">
          {revoke === 'revoked' ? (
            <p role="status" className="text-amber-200">
              Link revoked: it no longer works for anyone. People who already joined keep their
              minutes window.
            </p>
          ) : (
            <button
              type="button"
              disabled={revoke === 'revoking'}
              onClick={() => revokeLink(result.url)}
              className="text-slate-400 underline underline-offset-2 hover:text-rose-300 disabled:opacity-50"
            >
              {revoke === 'revoking' ? 'Revoking…' : 'Revoke this link'}
            </button>
          )}
          {typeof revoke === 'object' && (
            <p role="alert" className="mt-1 text-rose-300">
              {revoke.error}
            </p>
          )}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Your partner signs up free ({FREE_TRIAL_MINUTES} free minutes) and joins your room. Their
          call minutes come from your balance while the link&apos;s sponsorship is valid.
        </p>
      </Modal>
    )
  }

  return (
    <Modal title="Invite Partner" onClose={onClose}>
      <p className="text-sm text-slate-400">
        Your partner speaks and hears their own language, with {LANGUAGES_AND_VOICES}.
      </p>
      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Link valid for
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {INVITE_WINDOWS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-2 py-2.5 text-xs font-semibold text-slate-300 has-[:checked]:border-cyan-300/60 has-[:checked]:bg-cyan-300/10 has-[:checked]:text-cyan-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300"
            >
              <input
                type="radio"
                name="invite-window"
                value={option.id}
                checked={validity === option.id}
                onChange={() => setValidity(option.id)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
          People who can use the link
        </span>
        <select
          value={maxUses}
          onChange={(e) => setMaxUses(Number(e.target.value))}
          className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300"
        >
          {MAX_USES_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 1 ? '1 person (single use)' : `Up to ${n} people`}
            </option>
          ))}
        </select>
      </label>
      {result && !result.ok && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300"
        >
          {result.error}
          {result.code === 'NO_MINUTES' && onNoMinutes && (
            <button onClick={onNoMinutes} className="ml-1 font-semibold underline">
              Get minutes
            </button>
          )}
        </p>
      )}
      <Button onClick={create} disabled={pending} className="mt-5 w-full">
        <Link2 size={15} /> {pending ? 'Creating link…' : 'Create invite link'}
      </Button>
    </Modal>
  )
}

/** "Send invite by email": the server emails the branded invitation for this link. */
function SendInviteEmail({ inviteUrl }: { inviteUrl: string }) {
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<SendInviteEmailResult | null>(null)
  const [pending, startTransition] = useTransition()

  const send = (event: React.FormEvent) => {
    event.preventDefault()
    startTransition(async () => {
      const sent = await sendInvitationEmail({ inviteUrl, email })
      setResult(sent)
      if (sent.ok) setEmail('')
    })
  }

  return (
    <form onSubmit={send} className="mt-4 rounded-xl border border-white/10 bg-white/[.02] p-3">
      <label htmlFor="invite-email" className="block text-xs font-medium text-slate-400">
        Send invite by email
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="invite-email"
          type="email"
          required
          autoComplete="off"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (result) setResult(null)
          }}
          placeholder="partner@example.com"
          aria-invalid={result?.ok === false && result.code === 'INVALID'}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-300"
        />
        <Button type="submit" disabled={pending || !email} className="shrink-0 px-3 py-2 text-xs">
          <Send size={14} /> {pending ? 'Sending…' : 'Send Invite'}
        </Button>
      </div>
      {result?.ok && (
        <p role="status" className="mt-2 text-xs text-emerald-300">
          Invitation sent to {result.to}.
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {result.error}
        </p>
      )}
    </form>
  )
}
