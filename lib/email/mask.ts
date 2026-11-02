/** "private.person@example.com" → "p••••@example.com": what the invite modal shows back. */
export function maskEmail(address: string): string {
  const [local = '', domain = ''] = address.split('@')
  return `${local.slice(0, 1)}••••@${domain}`
}
