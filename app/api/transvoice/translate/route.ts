import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { TransVoiceApiError, translateSpeech } from '@/lib/transvoice/client'

/** Seconds billed per legacy recorder chunk (the old client always sent 3.0). */
const LEGACY_SECONDS_PER_CHUNK = 3

/**
 * LEGACY translate endpoint for the `/` meeting shell; replaced in Phase 3 by POST /api/translate,
 * and per-chunk billing by the Phase 4 minute meter.
 * Identity now comes from the session (client userId / duration are ignored). Signed-out legacy
 * guests are still translated unbilled until Phase 2 requires sign-in to join.
 */
export async function POST(req: NextRequest) {
  try {
    const { audio, tgt_lang, src_lang, azure_voice } = (await req.json()) as {
      audio: string
      tgt_lang?: string
      src_lang?: string
      azure_voice?: string
    }
    const user = await getSessionUser()
    const admin = createAdminClient()

    if (user) {
      const { data: available } = await admin.rpc('has_available_minutes', { p_user: user.id })
      if (!available) {
        return NextResponse.json(
          { error: 'Minute balance exhausted', code: 'OUT_OF_MINUTES' },
          { status: 402 },
        )
      }
    }

    const result = await translateSpeech({
      audio,
      tgtLang: tgt_lang || 'bn',
      srcLang: src_lang || 'auto',
      azureVoice: azure_voice || 'en-US-AvaNeural',
      speakerId: user?.id,
    })

    if (result.kind === 'silence') {
      return NextResponse.json({ error: 'Silence' })
    }

    if (user) {
      const { error } = await admin.rpc('debit_minutes', {
        p_payer: user.id,
        p_minutes: LEGACY_SECONDS_PER_CHUNK / 60,
        p_reason: 'legacy_chunk',
      })
      if (error) console.error('Legacy debit failed:', error.message)
    }

    return NextResponse.json({
      original_text: result.originalText,
      translated_text: result.translatedText,
      tts_audio: result.ttsAudio,
    })
  } catch (error: unknown) {
    const status = error instanceof TransVoiceApiError ? 502 : 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status })
  }
}
