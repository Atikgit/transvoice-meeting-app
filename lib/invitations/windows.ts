import { BRAND } from '@/lib/brand'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'

/** Link / sponsorship validity choices (Rule 3). Values match invitations.sponsor_window. */
export const INVITE_WINDOWS = [
  { id: '1h', label: '1 hour', interval: '1 hour' },
  { id: '24h', label: '24 hours', interval: '24 hours' },
  { id: '7d', label: '7 days', interval: '7 days' },
  { id: '30d', label: '30 days', interval: '30 days' },
] as const

export type InviteWindowId = (typeof INVITE_WINDOWS)[number]['id']
export const DEFAULT_INVITE_WINDOW: InviteWindowId = '7d'

export function inviteWindow(id: InviteWindowId) {
  return INVITE_WINDOWS.find((w) => w.id === id)!
}

/** Ready-made share targets for an invite link. */
export function shareLinks(url: string) {
  const text = `Join me on ${BRAND.name} for a live translated call: you speak your language, I hear mine. Sign up free (${FREE_TRIAL_MINUTES} free minutes) and join here: ${url}`
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    email: `mailto:?subject=${encodeURIComponent(`Join my ${BRAND.name} meeting`)}&body=${encodeURIComponent(text)}`,
  }
}
