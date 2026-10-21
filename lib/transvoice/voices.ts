export type VoiceGender = 'male' | 'female'

export const voiceMapping: Record<string, Record<VoiceGender, string>> = {
  'en-US': { male: 'en-US-AndrewNeural', female: 'en-US-AvaNeural' },
  'bn-BD': { male: 'bn-BD-PradeepNeural', female: 'bn-BD-NabanitaNeural' },
  'bn-IN': { male: 'bn-IN-BashkarNeural', female: 'bn-IN-TanishaaNeural' },
  'es-ES': { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },
  'es-US': { male: 'es-US-AlonsoNeural', female: 'es-US-PalomaNeural' },
  'fr-FR': { male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural' },
  'de-DE': { male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural' },
  'zh-CN': { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural' },
  'ja-JP': { male: 'ja-JP-KeitaNeural', female: 'ja-JP-NanamiNeural' },
  'ar-SA': { male: 'ar-SA-HamedNeural', female: 'ar-SA-ZariyahNeural' },
  'hi-IN': { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
  'pt-BR': { male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural' },
  'ru-RU': { male: 'ru-RU-DmitryNeural', female: 'ru-RU-SvetlanaNeural' },
  'it-IT': { male: 'it-IT-DiegoNeural', female: 'it-IT-ElsaNeural' },
  'ko-KR': { male: 'ko-KR-InJoonNeural', female: 'ko-KR-SunHiNeural' },
  'tr-TR': { male: 'tr-TR-AhmetNeural', female: 'tr-TR-EmelNeural' },
}

const DEFAULT_VOICE: Record<VoiceGender, string> = {
  male: 'en-US-AndrewNeural',
  female: 'en-US-AvaNeural',
}

/** Azure neural voice for a locale; falls back to English voices for unmapped locales. */
export function getVoiceName(langCode: string, gender: VoiceGender = 'female'): string {
  const match = voiceMapping[langCode]
  return match ? match[gender] : DEFAULT_VOICE[gender]
}
