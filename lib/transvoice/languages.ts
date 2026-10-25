/**
 * Languages offered in the pickers: every Azure Neural TTS locale (each has a voice in voices.ts),
 * from https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
 * (2026-10-22). `whisper` is set when Whisper can recognize the language as speech.
 */

/** Marketing copy for the language count; a test keeps it true (≥ 140 listen languages). */
export const LANGUAGE_COUNT_LABEL = '140+'
export const LANGUAGES_AND_VOICES = `${LANGUAGE_COUNT_LABEL} languages & voices`

export interface LanguageOption {
  /** BCP-47 locale, also used to pick the Azure neural voice (e.g. "bn-BD"). */
  code: string
  label: string
  /**
   * Whisper language code when speech in this language can be recognized ("fil-PH" → "tl").
   * Absent: the language can be heard (translation + voice) but not spoken. Cantonese ("yue")
   * needs Whisper large-v3.
   */
  whisper?: string
}

/** "I want to hear" options: every language with a neural voice. Sorted by label. */
export const languageOptions: LanguageOption[] = [
  { code: 'af-ZA', label: 'Afrikaans (South Africa)', whisper: 'af' },
  { code: 'sq-AL', label: 'Albanian (Albania)', whisper: 'sq' },
  { code: 'am-ET', label: 'Amharic (Ethiopia)', whisper: 'am' },
  { code: 'ar-DZ', label: 'Arabic (Algeria)', whisper: 'ar' },
  { code: 'ar-BH', label: 'Arabic (Bahrain)', whisper: 'ar' },
  { code: 'ar-EG', label: 'Arabic (Egypt)', whisper: 'ar' },
  { code: 'ar-IQ', label: 'Arabic (Iraq)', whisper: 'ar' },
  { code: 'ar-JO', label: 'Arabic (Jordan)', whisper: 'ar' },
  { code: 'ar-KW', label: 'Arabic (Kuwait)', whisper: 'ar' },
  { code: 'ar-LB', label: 'Arabic (Lebanon)', whisper: 'ar' },
  { code: 'ar-LY', label: 'Arabic (Libya)', whisper: 'ar' },
  { code: 'ar-MA', label: 'Arabic (Morocco)', whisper: 'ar' },
  { code: 'ar-OM', label: 'Arabic (Oman)', whisper: 'ar' },
  { code: 'ar-QA', label: 'Arabic (Qatar)', whisper: 'ar' },
  { code: 'ar-SA', label: 'Arabic (Saudi Arabia)', whisper: 'ar' },
  { code: 'ar-SY', label: 'Arabic (Syria)', whisper: 'ar' },
  { code: 'ar-TN', label: 'Arabic (Tunisia)', whisper: 'ar' },
  { code: 'ar-AE', label: 'Arabic (United Arab Emirates)', whisper: 'ar' },
  { code: 'ar-YE', label: 'Arabic (Yemen)', whisper: 'ar' },
  { code: 'hy-AM', label: 'Armenian (Armenia)', whisper: 'hy' },
  { code: 'as-IN', label: 'Assamese (India)', whisper: 'as' },
  { code: 'az-AZ', label: 'Azerbaijani (Latin, Azerbaijan)', whisper: 'az' },
  { code: 'bn-BD', label: 'Bangla (Bangladesh)', whisper: 'bn' },
  { code: 'eu-ES', label: 'Basque', whisper: 'eu' },
  { code: 'bn-IN', label: 'Bengali (India)', whisper: 'bn' },
  { code: 'bs-BA', label: 'Bosnian (Bosnia and Herzegovina)', whisper: 'bs' },
  { code: 'bg-BG', label: 'Bulgarian (Bulgaria)', whisper: 'bg' },
  { code: 'my-MM', label: 'Burmese (Myanmar)', whisper: 'my' },
  { code: 'ca-ES', label: 'Catalan', whisper: 'ca' },
  { code: 'yue-CN', label: 'Chinese (Cantonese, Simplified)', whisper: 'yue' },
  { code: 'zh-HK', label: 'Chinese (Cantonese, Traditional)', whisper: 'yue' },
  { code: 'zh-CN-guangxi', label: 'Chinese (Guangxi Accent Mandarin, Simplified)' },
  { code: 'zh-CN-shandong', label: 'Chinese (Jilu Mandarin, Simplified)' },
  { code: 'zh-CN', label: 'Chinese (Mandarin, Simplified)', whisper: 'zh' },
  { code: 'zh-CN-liaoning', label: 'Chinese (Northeastern Mandarin, Simplified)' },
  { code: 'zh-CN-sichuan', label: 'Chinese (Southwestern Mandarin, Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Taiwanese Mandarin, Traditional)', whisper: 'zh' },
  { code: 'wuu-CN', label: 'Chinese (Wu, Simplified)' },
  { code: 'zh-CN-henan', label: 'Chinese (Zhongyuan Mandarin Henan, Simplified)' },
  { code: 'zh-CN-shaanxi', label: 'Chinese (Zhongyuan Mandarin Shaanxi, Simplified)' },
  { code: 'hr-HR', label: 'Croatian (Croatia)', whisper: 'hr' },
  { code: 'cs-CZ', label: 'Czech (Czechia)', whisper: 'cs' },
  { code: 'da-DK', label: 'Danish (Denmark)', whisper: 'da' },
  { code: 'nl-BE', label: 'Dutch (Belgium)', whisper: 'nl' },
  { code: 'nl-NL', label: 'Dutch (Netherlands)', whisper: 'nl' },
  { code: 'en-AU', label: 'English (Australia)', whisper: 'en' },
  { code: 'en-CA', label: 'English (Canada)', whisper: 'en' },
  { code: 'en-HK', label: 'English (Hong Kong SAR)', whisper: 'en' },
  { code: 'en-IN', label: 'English (India)', whisper: 'en' },
  { code: 'en-IE', label: 'English (Ireland)', whisper: 'en' },
  { code: 'en-KE', label: 'English (Kenya)', whisper: 'en' },
  { code: 'en-NZ', label: 'English (New Zealand)', whisper: 'en' },
  { code: 'en-NG', label: 'English (Nigeria)', whisper: 'en' },
  { code: 'en-PH', label: 'English (Philippines)', whisper: 'en' },
  { code: 'en-SG', label: 'English (Singapore)', whisper: 'en' },
  { code: 'en-ZA', label: 'English (South Africa)', whisper: 'en' },
  { code: 'en-TZ', label: 'English (Tanzania)', whisper: 'en' },
  { code: 'en-GB', label: 'English (United Kingdom)', whisper: 'en' },
  { code: 'en-US', label: 'English (United States)', whisper: 'en' },
  { code: 'et-EE', label: 'Estonian (Estonia)', whisper: 'et' },
  { code: 'fil-PH', label: 'Filipino (Philippines)', whisper: 'tl' },
  { code: 'fi-FI', label: 'Finnish (Finland)', whisper: 'fi' },
  { code: 'fr-BE', label: 'French (Belgium)', whisper: 'fr' },
  { code: 'fr-CA', label: 'French (Canada)', whisper: 'fr' },
  { code: 'fr-FR', label: 'French (France)', whisper: 'fr' },
  { code: 'fr-CH', label: 'French (Switzerland)', whisper: 'fr' },
  { code: 'gl-ES', label: 'Galician', whisper: 'gl' },
  { code: 'ka-GE', label: 'Georgian (Georgia)', whisper: 'ka' },
  { code: 'de-AT', label: 'German (Austria)', whisper: 'de' },
  { code: 'de-DE', label: 'German (Germany)', whisper: 'de' },
  { code: 'de-CH', label: 'German (Switzerland)', whisper: 'de' },
  { code: 'el-GR', label: 'Greek (Greece)', whisper: 'el' },
  { code: 'gu-IN', label: 'Gujarati (India)', whisper: 'gu' },
  { code: 'he-IL', label: 'Hebrew (Israel)', whisper: 'he' },
  { code: 'hi-IN', label: 'Hindi (India)', whisper: 'hi' },
  { code: 'hu-HU', label: 'Hungarian (Hungary)', whisper: 'hu' },
  { code: 'is-IS', label: 'Icelandic (Iceland)', whisper: 'is' },
  { code: 'id-ID', label: 'Indonesian (Indonesia)', whisper: 'id' },
  { code: 'iu-Latn-CA', label: 'Inuktitut (Latin, Canada)' },
  { code: 'iu-Cans-CA', label: 'Inuktitut (Syllabics, Canada)' },
  { code: 'ga-IE', label: 'Irish (Ireland)' },
  { code: 'zu-ZA', label: 'isiZulu (South Africa)' },
  { code: 'it-IT', label: 'Italian (Italy)', whisper: 'it' },
  { code: 'ja-JP', label: 'Japanese (Japan)', whisper: 'ja' },
  { code: 'jv-ID', label: 'Javanese (Latin, Indonesia)', whisper: 'jw' },
  { code: 'kn-IN', label: 'Kannada (India)', whisper: 'kn' },
  { code: 'kk-KZ', label: 'Kazakh (Kazakhstan)', whisper: 'kk' },
  { code: 'km-KH', label: 'Khmer (Cambodia)', whisper: 'km' },
  { code: 'sw-KE', label: 'Kiswahili (Kenya)', whisper: 'sw' },
  { code: 'sw-TZ', label: 'Kiswahili (Tanzania)', whisper: 'sw' },
  { code: 'ko-KR', label: 'Korean (Korea)', whisper: 'ko' },
  { code: 'lo-LA', label: 'Lao (Laos)', whisper: 'lo' },
  { code: 'lv-LV', label: 'Latvian (Latvia)', whisper: 'lv' },
  { code: 'lt-LT', label: 'Lithuanian (Lithuania)', whisper: 'lt' },
  { code: 'mk-MK', label: 'Macedonian (North Macedonia)', whisper: 'mk' },
  { code: 'ms-MY', label: 'Malay (Malaysia)', whisper: 'ms' },
  { code: 'ml-IN', label: 'Malayalam (India)', whisper: 'ml' },
  { code: 'mt-MT', label: 'Maltese (Malta)', whisper: 'mt' },
  { code: 'mr-IN', label: 'Marathi (India)', whisper: 'mr' },
  { code: 'mn-MN', label: 'Mongolian (Mongolia)', whisper: 'mn' },
  { code: 'ne-NP', label: 'Nepali (Nepal)', whisper: 'ne' },
  { code: 'nb-NO', label: 'Norwegian Bokmål (Norway)', whisper: 'no' },
  { code: 'or-IN', label: 'Odia (India)' },
  { code: 'ps-AF', label: 'Pashto (Afghanistan)', whisper: 'ps' },
  { code: 'fa-IR', label: 'Persian (Iran)', whisper: 'fa' },
  { code: 'pl-PL', label: 'Polish (Poland)', whisper: 'pl' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', whisper: 'pt' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)', whisper: 'pt' },
  { code: 'pa-IN', label: 'Punjabi (India)', whisper: 'pa' },
  { code: 'ro-RO', label: 'Romanian (Romania)', whisper: 'ro' },
  { code: 'ru-RU', label: 'Russian (Russia)', whisper: 'ru' },
  { code: 'sr-RS', label: 'Serbian (Cyrillic, Serbia)', whisper: 'sr' },
  { code: 'sr-Latn-RS', label: 'Serbian (Latin, Serbia)', whisper: 'sr' },
  { code: 'si-LK', label: 'Sinhala (Sri Lanka)', whisper: 'si' },
  { code: 'sk-SK', label: 'Slovak (Slovakia)', whisper: 'sk' },
  { code: 'sl-SI', label: 'Slovenian (Slovenia)', whisper: 'sl' },
  { code: 'so-SO', label: 'Somali (Somalia)', whisper: 'so' },
  { code: 'es-AR', label: 'Spanish (Argentina)', whisper: 'es' },
  { code: 'es-BO', label: 'Spanish (Bolivia)', whisper: 'es' },
  { code: 'es-CL', label: 'Spanish (Chile)', whisper: 'es' },
  { code: 'es-CO', label: 'Spanish (Colombia)', whisper: 'es' },
  { code: 'es-CR', label: 'Spanish (Costa Rica)', whisper: 'es' },
  { code: 'es-CU', label: 'Spanish (Cuba)', whisper: 'es' },
  { code: 'es-DO', label: 'Spanish (Dominican Republic)', whisper: 'es' },
  { code: 'es-EC', label: 'Spanish (Ecuador)', whisper: 'es' },
  { code: 'es-SV', label: 'Spanish (El Salvador)', whisper: 'es' },
  { code: 'es-GQ', label: 'Spanish (Equatorial Guinea)', whisper: 'es' },
  { code: 'es-GT', label: 'Spanish (Guatemala)', whisper: 'es' },
  { code: 'es-HN', label: 'Spanish (Honduras)', whisper: 'es' },
  { code: 'es-MX', label: 'Spanish (Mexico)', whisper: 'es' },
  { code: 'es-NI', label: 'Spanish (Nicaragua)', whisper: 'es' },
  { code: 'es-PA', label: 'Spanish (Panama)', whisper: 'es' },
  { code: 'es-PY', label: 'Spanish (Paraguay)', whisper: 'es' },
  { code: 'es-PE', label: 'Spanish (Peru)', whisper: 'es' },
  { code: 'es-PR', label: 'Spanish (Puerto Rico)', whisper: 'es' },
  { code: 'es-ES', label: 'Spanish (Spain)', whisper: 'es' },
  { code: 'es-US', label: 'Spanish (United States)', whisper: 'es' },
  { code: 'es-UY', label: 'Spanish (Uruguay)', whisper: 'es' },
  { code: 'es-VE', label: 'Spanish (Venezuela)', whisper: 'es' },
  { code: 'su-ID', label: 'Sundanese (Indonesia)', whisper: 'su' },
  { code: 'sv-SE', label: 'Swedish (Sweden)', whisper: 'sv' },
  { code: 'ta-IN', label: 'Tamil (India)', whisper: 'ta' },
  { code: 'ta-MY', label: 'Tamil (Malaysia)', whisper: 'ta' },
  { code: 'ta-SG', label: 'Tamil (Singapore)', whisper: 'ta' },
  { code: 'ta-LK', label: 'Tamil (Sri Lanka)', whisper: 'ta' },
  { code: 'te-IN', label: 'Telugu (India)', whisper: 'te' },
  { code: 'th-TH', label: 'Thai (Thailand)', whisper: 'th' },
  { code: 'tr-TR', label: 'Turkish (Türkiye)', whisper: 'tr' },
  { code: 'uk-UA', label: 'Ukrainian (Ukraine)', whisper: 'uk' },
  { code: 'ur-IN', label: 'Urdu (India)', whisper: 'ur' },
  { code: 'ur-PK', label: 'Urdu (Pakistan)', whisper: 'ur' },
  { code: 'uz-UZ', label: 'Uzbek (Latin, Uzbekistan)', whisper: 'uz' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)', whisper: 'vi' },
  { code: 'cy-GB', label: 'Welsh (United Kingdom)', whisper: 'cy' },
]

/** "I speak" options: languages Whisper can recognize. */
export const spokenLanguageOptions: LanguageOption[] = languageOptions.filter((l) => l.whisper)

const languageCodes = new Set(languageOptions.map((l) => l.code))
const spokenCodes = new Set(spokenLanguageOptions.map((l) => l.code))

/** True for any listen language. */
export function isSupportedLanguage(code: string): boolean {
  return languageCodes.has(code)
}

/** True for languages that can be recognized as speech. */
export function isSpokenLanguage(code: string): boolean {
  return spokenCodes.has(code)
}

/**
 * Language codes arrive in several spellings ("bn", "bn-BD", "bn_bd", "BN-bd"). Everything that
 * compares languages, talks to the TransVoice API or picks a voice goes through the functions
 * below, so "same language" means the same thing everywhere.
 */

/** A bare language ("en") means this locale when a voice or a region is needed. */
const PREFERRED_LOCALE: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  ar: 'ar-SA',
  zh: 'zh-CN',
  hi: 'hi-IN',
  bn: 'bn-BD',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ru: 'ru-RU',
  tr: 'tr-TR',
  ur: 'ur-PK',
  ta: 'ta-IN',
  nl: 'nl-NL',
  sv: 'sv-SE',
  pl: 'pl-PL',
  id: 'id-ID',
  vi: 'vi-VN',
  th: 'th-TH',
  fa: 'fa-IR',
  uk: 'uk-UA',
  el: 'el-GR',
  fil: 'fil-PH',
}

/** Chinese written in traditional characters is a different target from simplified. */
const TRADITIONAL_REGIONS = new Set(['TW', 'HK', 'MO'])

/** "bn_bd" → "bn-BD", "BN-bd" → "bn-BD", "bn" → "bn-BD" (preferred locale), "zh-hant-tw" kept. */
export function normalizeLocale(input: string): string {
  const parts = input.trim().replace(/_/g, '-').split('-').filter(Boolean)
  const primary = parts[0]?.toLowerCase()
  if (!primary) return input.trim()
  const rest = parts.slice(1).map((part) => {
    if (part.length === 4) return part[0]!.toUpperCase() + part.slice(1).toLowerCase() // script
    if (part.length === 2) return part.toUpperCase() // region
    return part.toLowerCase() // variant (e.g. "guangxi")
  })
  const normalized = [primary, ...rest].join('-')
  if (rest.length > 0) return normalized
  return (
    PREFERRED_LOCALE[primary] ??
    languageOptions.find((l) => l.code.split('-')[0] === primary)?.code ??
    primary
  )
}

/**
 * What decides "same language": the primary subtag ("bn-BD" and "bn-IN" are both Bangla, "en-US"
 * and "en-GB" both English), except Chinese: traditional (zh-TW / zh-HK / zh-Hant) and simplified
 * differ, and Cantonese ("yue") is its own language.
 */
export function languageKey(input: string): string {
  const locale = normalizeLocale(input)
  const [primary = '', ...rest] = locale.split('-')
  if (primary === 'zh') {
    const traditional = rest.includes('Hant') || rest.some((part) => TRADITIONAL_REGIONS.has(part))
    return traditional ? 'zh-Hant' : 'zh'
  }
  return primary
}

export function sameLanguage(a: string, b: string): boolean {
  return languageKey(a) === languageKey(b)
}

/**
 * The code the TransVoice API gets as src_lang / tgt_lang: the bare language ("bn", "en"), as
 * the API's contract examples and defaults ("bn") show. Never a locale.
 */
export function toApiLang(locale: string): string {
  return languageKey(locale).split('-')[0]!
}
