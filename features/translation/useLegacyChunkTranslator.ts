'use client'

import { useEffect, useEffectEvent } from 'react'
import { getVoiceName } from '@/lib/transvoice/voices'
import { toApiLang } from '@/lib/transvoice/languages'
import type { TranslationCaption } from '@/features/meeting/types'

const CHUNK_MS = 3500

/**
 * Legacy fixed-interval MediaRecorder translator, kept unchanged for Phase 0.
 * Known issues (fixed in Phase 3 by VAD + server-side per-listener fan-out):
 * cuts words mid-chunk, uploads silence, translates into the speaker's own target language,
 * and sends a client-supplied userId / hardcoded duration for billing.
 */
export function useLegacyChunkTranslator({
  enabled,
  stream,
  tgtLang,
  userId,
  onResult,
  onTranslatingChange,
}: {
  enabled: boolean
  stream: MediaStream | null
  tgtLang: string
  userId: string | undefined
  onResult: (caption: TranslationCaption) => void
  onTranslatingChange: (translating: boolean) => void
}) {
  const emitResult = useEffectEvent(onResult)
  const emitTranslating = useEffectEvent(onTranslatingChange)

  useEffect(() => {
    if (!enabled || !stream) return
    let recorder: MediaRecorder | null = null
    let chunks: Blob[] = []

    try {
      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) return

      // Audio-only stream so the browser doesn't reject the mime type.
      const pureAudioStream = new MediaStream(audioTracks)

      recorder = new MediaRecorder(pureAudioStream, { mimeType: 'audio/webm' })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = async () => {
        if (chunks.length === 0) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        chunks = []

        const reader = new FileReader()
        reader.readAsDataURL(blob)
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string | null)?.split(',')[1]
          if (!base64Audio) return

          emitTranslating(true)
          try {
            const res = await fetch('/api/transvoice/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audio: base64Audio,
                tgt_lang: toApiLang(tgtLang),
                azure_voice: getVoiceName(tgtLang, 'female'),
                userId,
                audioDurationSeconds: 3.0,
              }),
            })

            const data: { original_text?: string; translated_text?: string; tts_audio?: string } =
              await res.json()
            if (data.original_text && data.translated_text) {
              emitResult({
                original: data.original_text,
                translated: data.translated_text,
                audio: data.tts_audio,
              })
            }
          } catch (e) {
            console.error('Translation error:', e)
          } finally {
            emitTranslating(false)
          }
        }
      }

      recorder.start()
      const interval = setInterval(() => {
        if (recorder && recorder.state === 'recording') {
          recorder.stop()
          recorder.start()
        }
      }, CHUNK_MS)

      return () => {
        clearInterval(interval)
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      }
    } catch (e) {
      console.log('Recorder init error:', e)
    }
  }, [enabled, stream, tgtLang, userId])
}
