import 'server-only'
import { createHash } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { join } from 'node:path'
import { Reader, type ReaderModel } from '@maxmind/geoip2-node'

/**
 * Signup country, stored on profiles for analytics only (never shown in the UI).
 *
 * The client IP comes from proxy headers. They are trusted only because the app is reachable
 * solely through Nginx on the same host (the container port is bound to 127.0.0.1:3003).
 * The raw IP is never stored: only sha256(ip + IP_HASH_SALT).
 */

export const DEFAULT_GEOIP_DB_PATH = join(process.cwd(), 'geoip', 'GeoLite2-Country.mmdb')

export interface Country {
  code: string
  name: string
}

export interface SignupGeo {
  countryCode: string | null
  countryName: string | null
  ipHash: string | null
}

/** First X-Forwarded-For value, else X-Real-IP; null when absent or not an IP address. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]
  return normalizeIp(forwarded) ?? normalizeIp(headers.get('x-real-ip'))
}

function normalizeIp(value: string | null | undefined): string | null {
  let ip = value?.trim()
  if (!ip) return null
  // "[2001:db8::1]:443" or "203.0.113.7:51234"
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip)
  if (bracketed) ip = bracketed[1]!
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))
  // IPv4-mapped IPv6 ("::ffff:203.0.113.7") → IPv4
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) ip = mapped[1]!
  return isIP(ip) ? ip.toLowerCase() : null
}

const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // multicast and reserved
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 127], // unspecified and loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

/** False for private, loopback, link-local and other non-routable addresses. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return false
  return !NON_PUBLIC.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

function countryFromCode(code: string): Country | null {
  const upper = code.trim().toUpperCase()
  // XX = unknown, T1 = Tor (Cloudflare)
  if (!/^[A-Z]{2}$/.test(upper) || upper === 'XX' || upper === 'T1') return null
  const name = regionNames.of(upper)
  return name && name !== upper ? { code: upper, name } : null
}

/** Cloudflare's CF-IPCountry header, when the site is proxied by Cloudflare. */
export function countryFromCloudflare(headers: Headers): Country | null {
  const value = headers.get('cf-ipcountry')
  return value ? countryFromCode(value) : null
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256')
    .update(ip + salt)
    .digest('hex')
}

let reader: Promise<ReaderModel | null> | undefined
let readerPath: string | undefined

function openReader(path: string): Promise<ReaderModel | null> {
  if (!reader || readerPath !== path) {
    readerPath = path
    reader = Reader.open(path).catch((error: unknown) => {
      console.warn(
        `GeoIP database unavailable at ${path}; signup country is not recorded.`,
        error instanceof Error ? error.message : error,
      )
      return null
    })
  }
  return reader
}

/** Offline GeoLite2-Country lookup. Null when the database is missing or the IP is unknown. */
export async function lookupCountry(
  ip: string,
  dbPath = DEFAULT_GEOIP_DB_PATH,
): Promise<Country | null> {
  if (!isPublicIp(ip)) return null
  const db = await openReader(dbPath)
  if (!db) return null
  try {
    const { country } = db.country(ip)
    if (!country?.isoCode) return null
    return {
      code: country.isoCode,
      name: country.names.en ?? countryFromCode(country.isoCode)?.name ?? country.isoCode,
    }
  } catch {
    return null // AddressNotFoundError and malformed addresses
  }
}

/** Country and IP hash for the current request. Never throws. */
export async function resolveSignupGeo(
  headers: Headers,
  { salt, dbPath }: { salt?: string; dbPath?: string },
): Promise<SignupGeo> {
  try {
    const ip = clientIpFromHeaders(headers)
    const publicIp = ip && isPublicIp(ip) ? ip : null
    const country =
      countryFromCloudflare(headers) ?? (publicIp ? await lookupCountry(publicIp, dbPath) : null)
    return {
      countryCode: country?.code ?? null,
      countryName: country?.name ?? null,
      ipHash: publicIp && salt ? hashIp(publicIp, salt) : null,
    }
  } catch (error) {
    console.error('Signup geo lookup failed:', error)
    return { countryCode: null, countryName: null, ipHash: null }
  }
}
