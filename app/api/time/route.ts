import { NextResponse } from 'next/server'

/**
 * GET /api/time — the server's clock in ms. Each browser pings it a few times when it joins a room
 * and works out how far its own clock is from the server's (features/translation/clock.ts), so
 * "speech end → audio start" is not inflated by two devices whose clocks differ.
 */
export function GET() {
  return NextResponse.json({ t: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
}
