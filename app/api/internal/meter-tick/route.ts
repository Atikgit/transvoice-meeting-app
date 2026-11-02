import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { meterTickOnce } from '@/lib/billing/meter'
import { serverEnv } from '@/lib/env'

function authorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * POST /api/internal/meter-tick — runs apply_minute_tick once (manual re-run, or an external
 * cron when pg_cron is not available). Authorization: Bearer $CRON_SECRET. Safe at any time: the
 * SQL takes a lock and is idempotent. Answers counts only.
 */
export async function POST(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  if (!authorised(request, secret)) return new NextResponse(null, { status: 401 })
  try {
    return NextResponse.json(await meterTickOnce('http'))
  } catch {
    return NextResponse.json({ error: 'Tick failed.' }, { status: 503 })
  }
}
