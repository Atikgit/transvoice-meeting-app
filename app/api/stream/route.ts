import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { isDraining } from '@/lib/draining'
import { serverEnv } from '@/lib/env'
import { getSessionUser } from '@/lib/supabase/server'
import { loadTranslationContext } from '@/lib/translation/context'
import { SSE_HEARTBEAT_MS, subscribeSse } from '@/lib/translation/sse-hub'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stream?sessionId= (DELIVERY=sse): a text/event-stream the app server pushes captions
 * and clips into, for the signed-in user who is a connected participant of that live session.
 * Each event carries the topic and the exact bytes LiveKit would have delivered. A heartbeat
 * comment every 15 s keeps proxies from closing it.
 */
export async function GET(request: NextRequest) {
  if (serverEnv().DELIVERY !== 'sse') {
    return NextResponse.json({ error: 'Not enabled.' }, { status: 404 })
  }
  if (isDraining()) return NextResponse.json({ error: 'Restarting.' }, { status: 503 })
  const user = await getSessionUser({ local: true })
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const sessionId = z.uuid().safeParse(request.nextUrl.searchParams.get('sessionId'))
  if (!sessionId.success) return NextResponse.json({ error: 'Bad session.' }, { status: 400 })

  // Admitted participants only: a connected participant of this live session.
  const loaded = await loadTranslationContext(sessionId.data, user.id)
  if (!loaded.ok)
    return NextResponse.json({ code: loaded.code, error: loaded.error }, { status: loaded.status })

  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write = (text: string) => {
        if (!open) return false
        try {
          controller.enqueue(encoder.encode(text))
          return true
        } catch {
          close()
          return false
        }
      }
      const unsubscribe = subscribeSse(sessionId.data, user.id, { write })
      const heartbeat = setInterval(() => write(': ping\n\n'), SSE_HEARTBEAT_MS)
      function close() {
        if (!open) return
        open = false
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      cleanup = close
      request.signal.addEventListener('abort', close)
      write('retry: 3000\n: connected\n\n')
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
