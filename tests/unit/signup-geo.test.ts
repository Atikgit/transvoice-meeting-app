import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

// The real GeoLite2 database is not in the repo; the reader is faked per test.
const country = vi.fn()
const open = vi.fn(async (path: string) => {
  if (path.includes('missing')) throw new Error(`ENOENT: no such file, open '${path}'`)
  return { country }
})
vi.mock('@maxmind/geoip2-node', () => ({ Reader: { open } }))

const { clientIpFromHeaders, hashIp, isPublicIp, lookupCountry, resolveSignupGeo } =
  await import('@/lib/geo/signup-geo')

const SALT = 'test-salt-0123456789'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

describe('clientIpFromHeaders', () => {
  it('takes the first X-Forwarded-For value', () => {
    const h = new Headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 172.17.0.1' })
    expect(clientIpFromHeaders(h)).toBe('203.0.113.7')
  })

  it('falls back to X-Real-IP', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(
      clientIpFromHeaders(
        new Headers({ 'x-forwarded-for': 'garbage', 'x-real-ip': '2001:db8::1' }),
      ),
    ).toBe('2001:db8::1')
  })

  it('strips ports, brackets and the IPv4-mapped prefix', () => {
    const ip = (value: string) => clientIpFromHeaders(new Headers({ 'x-forwarded-for': value }))
    expect(ip('203.0.113.7:51234')).toBe('203.0.113.7')
    expect(ip('[2001:DB8::1]:443')).toBe('2001:db8::1')
    expect(ip('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('returns null without usable headers', () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull()
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': 'unknown' }))).toBeNull()
  })
})

describe('isPublicIp', () => {
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    'not-an-ip',
  ])('%s is not public', (ip) => expect(isPublicIp(ip)).toBe(false))

  it.each(['203.0.113.7', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888'])('%s is public', (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  )
})

describe('lookupCountry', () => {
  it('returns the ISO code and English name', async () => {
    country.mockReturnValueOnce({ country: { isoCode: 'BD', names: { en: 'Bangladesh' } } })
    expect(await lookupCountry('103.4.145.1', '/app/geoip/test.mmdb')).toEqual({
      code: 'BD',
      name: 'Bangladesh',
    })
  })

  it('returns null for unknown addresses', async () => {
    country.mockImplementationOnce(() => {
      throw new Error('AddressNotFoundError')
    })
    expect(await lookupCountry('203.0.113.9', '/app/geoip/test.mmdb')).toBeNull()
  })

  it('returns null, without throwing, when the database file is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await lookupCountry('8.8.8.8', '/missing/GeoLite2-Country.mmdb')).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('never looks up private addresses', async () => {
    country.mockClear()
    expect(await lookupCountry('192.168.0.10', '/app/geoip/test.mmdb')).toBeNull()
    expect(country).not.toHaveBeenCalled()
  })
})

describe('resolveSignupGeo', () => {
  const dbPath = '/app/geoip/test.mmdb'

  it('stores a salted hash, never the raw IP', async () => {
    country.mockReturnValueOnce({ country: { isoCode: 'DE', names: { en: 'Germany' } } })
    const geo = await resolveSignupGeo(new Headers({ 'x-forwarded-for': '203.0.113.7' }), {
      salt: SALT,
      dbPath,
    })
    expect(geo).toEqual({
      countryCode: 'DE',
      countryName: 'Germany',
      ipHash: sha(`203.0.113.7${SALT}`),
    })
    expect(geo.ipHash).toBe(hashIp('203.0.113.7', SALT))
    expect(JSON.stringify(geo)).not.toContain('203.0.113.7')
  })

  it('uses CF-IPCountry directly when Cloudflare sends it', async () => {
    country.mockClear()
    const geo = await resolveSignupGeo(
      new Headers({ 'cf-ipcountry': 'bd', 'x-forwarded-for': '203.0.113.7' }),
      { salt: SALT, dbPath },
    )
    expect(geo.countryCode).toBe('BD')
    expect(geo.countryName).toBe('Bangladesh')
    expect(country).not.toHaveBeenCalled()
  })

  it('ignores Cloudflare unknown/Tor codes', async () => {
    country.mockReturnValueOnce({ country: { isoCode: 'FR', names: { en: 'France' } } })
    const geo = await resolveSignupGeo(
      new Headers({ 'cf-ipcountry': 'XX', 'x-forwarded-for': '203.0.113.8' }),
      { salt: SALT, dbPath },
    )
    expect(geo.countryCode).toBe('FR')
  })

  it('stores nothing for private or loopback IPs', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '::1']) {
      expect(
        await resolveSignupGeo(new Headers({ 'x-forwarded-for': ip }), { salt: SALT, dbPath }),
      ).toEqual({ countryCode: null, countryName: null, ipHash: null })
    }
  })

  it('stores no hash without a salt', async () => {
    country.mockReturnValueOnce({ country: { isoCode: 'US', names: { en: 'United States' } } })
    const geo = await resolveSignupGeo(new Headers({ 'x-real-ip': '8.8.8.8' }), { dbPath })
    expect(geo).toMatchObject({ countryCode: 'US', ipHash: null })
  })
})

describe('privacy', () => {
  it('no UI code references the signup geo columns', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const files = ['app', 'components', 'features'].flatMap((dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => `${entry.parentPath}/${entry.name}`),
    )
    const offenders = files.filter((file) =>
      /country_code|country_name|signup_ip_hash|signup_at/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
