import 'server-only'
import { headers } from 'next/headers'

/**
 * Public origin of the current request, from the proxy headers (Caddy / Vercel) or Host.
 * Supabase only redirects to allow-listed URLs, so a spoofed Host cannot cause an open redirect.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto.split(',')[0]!.trim()}://${host.split(',')[0]!.trim()}`
}

/** Client IP as reported by the reverse proxy; "unknown" when absent. */
export async function clientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
}
