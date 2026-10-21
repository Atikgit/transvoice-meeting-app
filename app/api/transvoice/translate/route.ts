import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TransVoiceApiError, translateSpeech } from '@/lib/transvoice/client'

/**
 * LEGACY (Phase 0: behaviour preserved). Replaced in Phase 3 by POST /api/translate.
 * Known issues: trusts client userId and audioDurationSeconds (§2.1 #1, #2, #10).
 */
export async function POST(req: NextRequest) {
  try {
    const { audio, tgt_lang, src_lang, azure_voice, userId, audioDurationSeconds } =
      (await req.json()) as {
        audio: string
        tgt_lang?: string
        src_lang?: string
        azure_voice?: string
        userId?: string
        audioDurationSeconds?: number
      }
    const supabase = createAdminClient()

    if (userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('minutes_balance')
        .eq('id', userId)
        .single()

      if (!profile || profile.minutes_balance <= 0) {
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
    })

    if (result.kind === 'silence') {
      return NextResponse.json({ error: 'Silence' })
    }

    if (userId && audioDurationSeconds) {
      const usedMinutes = audioDurationSeconds / 60.0
      await supabase.rpc('deduct_user_minutes', {
        p_user_id: userId,
        p_minutes: usedMinutes,
      })
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
