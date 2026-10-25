import 'server-only'
import { z } from 'zod'
import { connectedIdentities } from '@/lib/livekit/connected'
import { createAdminClient } from '@/lib/supabase/admin'

const contextSchema = z.object({
  hostId: z.string(),
  hostEmail: z.string().nullable(),
  speaker: z.object({
    userId: z.string(),
    spokenLang: z.string(),
    payerId: z.string(),
    payerHasMinutes: z.boolean(),
    voiceGender: z.enum(['male', 'female']),
  }),
  participants: z.array(z.object({ userId: z.string(), listenLang: z.string() })),
})

export type TranslationContext = z.infer<typeof contextSchema>

export type ContextError = { status: 403 | 404 | 409 | 500 | 503; code: string; error: string }

const ERRORS: Record<string, ContextError> = {
  NO_SESSION: { status: 404, code: 'NO_SESSION', error: 'Unknown session.' },
  SESSION_NOT_LIVE: {
    status: 409,
    code: 'SESSION_NOT_LIVE',
    error: 'The meeting has not started.',
  },
  NOT_A_PARTICIPANT: {
    status: 403,
    code: 'NOT_A_PARTICIPANT',
    error: 'You are not in this meeting.',
  },
  NOT_CONNECTED: {
    status: 403,
    code: 'NOT_CONNECTED',
    error: 'You are not connected to this meeting.',
  },
}

/**
 * The live session's speaker and the participants connected right now (meeting_participants ∩
 * LiveKit). The caller must be a connected participant.
 */
export async function loadTranslationContext(
  sessionId: string,
  speakerId: string,
): Promise<{ ok: true; context: TranslationContext } | ({ ok: false } & ContextError)> {
  const [{ data, error }, connected] = await Promise.all([
    createAdminClient().rpc('translation_context', { p_session: sessionId, p_speaker: speakerId }),
    connectedIdentities(sessionId).catch((e: unknown) => {
      console.error(
        JSON.stringify({
          event: 'translate_error',
          stage: 'livekit_participants',
          detail: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
        }),
      )
      return null
    }),
  ])
  if (error) {
    const known = Object.keys(ERRORS).find((key) => error.message.includes(key))
    if (!known) console.error('translation_context failed:', error.message)
    return {
      ok: false,
      ...(known ? ERRORS[known]! : { status: 500, code: 'FAILED', error: 'Please try again.' }),
    }
  }
  if (!connected) {
    return {
      ok: false,
      status: 503,
      code: 'LIVEKIT_UNAVAILABLE',
      error: 'Could not check who is connected. Please try again.',
    }
  }
  const context = contextSchema.parse(data)
  if (!connected.has(speakerId)) return { ok: false, ...ERRORS.NOT_CONNECTED! }
  return {
    ok: true,
    context: {
      ...context,
      participants: context.participants.filter((p) => connected.has(p.userId)),
    },
  }
}
