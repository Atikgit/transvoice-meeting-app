export interface LanguageOption {
  /** BCP-47 locale, also used to pick the Azure neural voice (e.g. "bn-BD"). */
  code: string
  label: string
}

export const languageOptions: LanguageOption[] = [
  { code: 'en-US', label: 'English (United States)' },
  { code: 'bn-BD', label: 'Bangla (Bangladesh)' },
  { code: 'bn-IN', label: 'Bangla (India)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-US', label: 'Spanish (USA)' },
  { code: 'fr-FR', label: 'French (France)' },
  { code: 'de-DE', label: 'German (Germany)' },
  { code: 'zh-CN', label: 'Chinese (Mandarin, Simplified)' },
  { code: 'ja-JP', label: 'Japanese (Japan)' },
  { code: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
  { code: 'hi-IN', label: 'Hindi (India)' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'ru-RU', label: 'Russian (Russia)' },
  { code: 'it-IT', label: 'Italian (Italy)' },
  { code: 'ko-KR', label: 'Korean (Korea)' },
  { code: 'tr-TR', label: 'Turkish (Turkey)' },
  { code: 'nl-NL', label: 'Dutch (Netherlands)' },
  { code: 'pl-PL', label: 'Polish (Poland)' },
  { code: 'sv-SE', label: 'Swedish (Sweden)' },
  { code: 'id-ID', label: 'Indonesian (Indonesia)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
  { code: 'th-TH', label: 'Thai (Thailand)' },
  { code: 'ur-PK', label: 'Urdu (Pakistan)' },
  { code: 'fa-IR', label: 'Persian (Iran)' },
  { code: 'uk-UA', label: 'Ukrainian (Ukraine)' },
  { code: 'ro-RO', label: 'Romanian (Romania)' },
  { code: 'el-GR', label: 'Greek (Greece)' },
  { code: 'cs-CZ', label: 'Czech (Czechia)' },
  { code: 'da-DK', label: 'Danish (Denmark)' },
  { code: 'fi-FI', label: 'Finnish (Finland)' },
  { code: 'he-IL', label: 'Hebrew (Israel)' },
  { code: 'hu-HU', label: 'Hungarian (Hungary)' },
  { code: 'ms-MY', label: 'Malay (Malaysia)' },
  { code: 'no-NO', label: 'Norwegian (Norway)' },
  { code: 'sk-SK', label: 'Slovak (Slovakia)' },
  { code: 'ta-IN', label: 'Tamil (India)' },
  { code: 'te-IN', label: 'Telugu (India)' },
  { code: 'mr-IN', label: 'Marathi (India)' },
  { code: 'gu-IN', label: 'Gujarati (India)' },
  { code: 'kn-IN', label: 'Kannada (India)' },
  { code: 'ml-IN', label: 'Malayalam (India)' },
  { code: 'pa-IN', label: 'Punjabi (India)' },
  { code: 'fil-PH', label: 'Filipino (Philippines)' },
  { code: 'sw-KE', label: 'Swahili (Kenya)' },
  { code: 'af-ZA', label: 'Afrikaans (South Africa)' },
  { code: 'am-ET', label: 'Amharic (Ethiopia)' },
  { code: 'az-AZ', label: 'Azerbaijani (Azerbaijan)' },
  { code: 'bg-BG', label: 'Bulgarian (Bulgaria)' },
  { code: 'bs-BA', label: 'Bosnian (Bosnia)' },
  { code: 'ca-ES', label: 'Catalan (Spain)' },
  { code: 'hr-HR', label: 'Croatian (Croatia)' },
  { code: 'et-EE', label: 'Estonian (Estonia)' },
  { code: 'gl-ES', label: 'Galician (Spain)' },
  { code: 'ka-GE', label: 'Georgian (Georgia)' },
  { code: 'is-IS', label: 'Icelandic (Iceland)' },
  { code: 'kk-KZ', label: 'Kazakh (Kazakhstan)' },
  { code: 'km-KH', label: 'Khmer (Cambodia)' },
  { code: 'lo-LA', label: 'Lao (Laos)' },
  { code: 'lv-LV', label: 'Latvian (Latvia)' },
  { code: 'lt-LT', label: 'Lithuanian (Lithuania)' },
  { code: 'mk-MK', label: 'Macedonian (North Macedonia)' },
  { code: 'mn-MN', label: 'Mongolian (Mongolia)' },
  { code: 'my-MM', label: 'Burmese (Myanmar)' },
  { code: 'ne-NP', label: 'Nepali (Nepal)' },
  { code: 'si-LK', label: 'Sinhala (Sri Lanka)' },
  { code: 'sl-SI', label: 'Slovenian (Slovenia)' },
  { code: 'so-SO', label: 'Somali (Somalia)' },
  { code: 'sq-AL', label: 'Albanian (Albania)' },
  { code: 'sr-RS', label: 'Serbian (Serbia)' },
  { code: 'uz-UZ', label: 'Uzbek (Uzbekistan)' },
  { code: 'zu-ZA', label: 'Zulu (South Africa)' },
]

const languageCodes = new Set(languageOptions.map((l) => l.code))

export function isSupportedLanguage(code: string): boolean {
  return languageCodes.has(code)
}

/** Converts a locale ("bn-BD") to the language code the TransVoice API expects ("bn"). */
export function toApiLang(locale: string): string {
  return locale.split('-')[0] ?? locale
}
