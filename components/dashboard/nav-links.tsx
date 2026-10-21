'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
