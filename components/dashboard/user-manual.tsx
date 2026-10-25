'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  Captions,
  ChevronDown,
  Languages,
  Share2,
  UserPlus,
  Video,
  Wallet,
} from 'lucide-react'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'

const STEPS: { icon: typeof Languages; title: string; body: ReactNode }[] = [
  {
    icon: Languages,
    title: 'Choose your languages',
    body: (
      <>
        Pick what you speak and what you want to hear, in{' '}
        <Link href="/dashboard/settings" className="text-cyan-300 hover:text-cyan-200">
          Settings
        </Link>{' '}
        or the lobby.
      </>
    ),
  },
  {
    icon: UserPlus,
    title: 'Start a meeting and invite your partner',
    body: 'Click Start meeting, then press Invite Partner inside the room and share the link (WhatsApp, LinkedIn, email).',
  },
  {
    icon: Share2,
    title: 'Your partner joins',
    body: `Your partner opens the link, signs up free (gets ${FREE_TRIAL_MINUTES} free minutes) and joins your room.`,
  },
  {
    icon: Video,
    title: 'Start the meeting',
    body: 'Check camera and mic in the lobby, then press "Start" in the room once your partner has joined.',
  },
  {
    icon: Captions,
    title: 'Speak naturally',
    body: 'Your partner hears you in their language within about a second; captions show both texts.',
  },
  {
    icon: Wallet,
    title: 'Billing',
    body: "Minutes count only while 2+ people are connected; your invited partner's minutes come from your balance. Chat is always free.",
  },
]

/** "How to start a meeting with your partner": always open on desktop, collapsible on mobile. */
export function UserManual() {
  const [open, setOpen] = useState(false)
  const listId = useId()

  return (
    <section
      aria-labelledby={`${listId}-title`}
      className="mt-10 rounded-2xl border border-white/10 bg-white/[.03] p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`${listId}-title`}
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <BookOpen size={16} className="text-cyan-300" aria-hidden />
          User Manual — How to start a meeting with your partner
        </h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 md:hidden"
        >
          {open ? 'Hide' : 'Show'} steps
          <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden />
        </button>
      </div>
      <ol
        id={listId}
        className={`${open ? 'grid' : 'hidden'} mt-5 gap-3 sm:grid-cols-2 md:grid lg:grid-cols-3`}
      >
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li
            key={title}
            className="flex gap-3 rounded-xl border border-white/[.06] bg-white/[.02] p-4"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-300">
              <Icon size={16} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">
                <span className="text-cyan-300">{index + 1}.</span> {title}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
