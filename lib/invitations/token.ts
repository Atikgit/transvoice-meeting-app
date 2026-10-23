import { createHash, randomBytes } from 'node:crypto'

/** Invite tokens: 32 random bytes in the URL, only their SHA-256 in the database (§9). */
export function createInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** base64url of 32 bytes; anything else is rejected before touching the database. */
export function isInviteToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}
