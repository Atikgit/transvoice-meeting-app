/**
 * The client's country from Cloudflare's CF-IPCountry header: two letters, or nothing. "XX"
 * (unknown) and "T1" (Tor) are not countries. The IP address itself is never read or stored.
 */
export function countryFrom(request: { headers: Headers }): string | undefined {
  const value = request.headers.get('cf-ipcountry')?.trim().toUpperCase()
  return value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1' ? value : undefined
}
