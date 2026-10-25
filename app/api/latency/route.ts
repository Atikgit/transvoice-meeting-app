import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/supabase/server'
import { logLatency } from '@/lib/translation/log'

const ms = z.number().int().min(0).max(120_000)
const body = z.object({
  sessionId: z.uuid(),
  utteranceId: z.uuid(),
  kind: z.enum(['speak', 'listen']),
  lang: z.string().max(16).optional(),
  encodeMs: ms.optional(),
  roundTripMs: ms.optional(),
  bytes: z.number().int().min(0).max(4_000_000).optional(),
  captionMs: ms.optional(),
  audioMs: ms.optional(),
  fetchMs: ms.optional(),
  via: z.enum(['url', 'inline']).optional(),
})

/**
 * POST /api/latency — what a browser measured for one utterance (speaker: encode + round trip;
 * listener: speech end → caption / audio). Written to the server log for `pnpm latency:report`;
 * nothing is stored. Signed-in users only, rate-limited, fields bounded.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await checkRateLimit('latency', user.id))) return new NextResponse(null, { status: 429 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid report.' }, { status: 400 })
  logLatency(parsed.data)
  return new NextResponse(null, { status: 204 })
}
