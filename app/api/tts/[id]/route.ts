import { NextResponse } from 'next/server'
import { audioCache, isAudioId } from '@/lib/translation/audio-cache'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * GET /api/tts/[id] — a translated clip, only for the users it was sent to, for 60 s.
 * Unknown, expired and foreign clips all answer 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const { id } = await params
  if (!isAudioId(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const entry = await audioCache().get(id)
  if (!entry || !entry.recipients.includes(user.id)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return new Response(new Uint8Array(entry.audio), {
    headers: {
      'Content-Type': entry.mime,
      'Content-Length': String(entry.audio.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
