import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/supabase/server'
import { captureAllowed, captureEnabled, readDropped } from '@/lib/translation/dropped-capture'

/**
 * GET /api/debug/dropped/[utteranceId][?download=1] — the WAV of one of the signed-in user's own
 * dropped utterances (inline for playing, attachment with download=1). Nobody else's audio is
 * ever served; 404 while DEBUG_CAPTURE_DROPPED is false or once the file has expired.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!captureEnabled()) return new NextResponse(null, { status: 404 })
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await captureAllowed(user.id))) return new NextResponse(null, { status: 404 })
  const { id } = await params
  const wav = await readDropped(user.id, id)
  if (!wav) return new NextResponse(null, { status: 404 })
  const download = new URL(request.url).searchParams.get('download') === '1'
  return new NextResponse(wav as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wav.length),
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="dropped-${id.slice(0, 8)}.wav"`,
    },
  })
}
