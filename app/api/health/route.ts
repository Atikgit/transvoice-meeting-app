import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Liveness probe for the container healthcheck. Phase 3 adds a Triton reachability check. */
export function GET() {
  return NextResponse.json({ status: 'ok' })
}
