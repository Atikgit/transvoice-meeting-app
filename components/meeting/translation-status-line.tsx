import { shortLanguageName } from '@/lib/translation/plan'
import type { TranslationStatus } from '@/features/translation/useTranslationStatus'

/**
 * One plain sentence about what translation will do right now, from the server-confirmed values:
 * "You speak Bangla → Atikul hears English · You hear Atikul in Bangla". When both people have set
 * "I want to hear" to the other's language, it says so and offers the one-tap fix.
 */
export function describeTranslation(status: TranslationStatus | null): {
  text: string
  tone: 'ok' | 'info' | 'warn'
  fix?: { label: string; listenLang: string }
} {
  if (!status) return { text: 'Checking translation…', tone: 'info' }
  const { decision, fanout, me } = status
  if (!decision.allowed)
    return { text: decision.message ?? 'Translation is not available.', tone: 'warn' }
  if (status.api === 'rejected') {
    return {
      text: 'Translation service rejected our access key. Translation is unavailable.',
      tone: 'warn',
    }
  }
  if (fanout.reason === 'no_listeners') {
    return { text: 'Waiting for your partner to connect.', tone: 'info' }
  }
  const mine = shortLanguageName(me.spokenLang)
  if (fanout.reason === 'same_language') {
    if (status.swapped) {
      return {
        text: `Nothing is translated: you each hear the other's own language. "I want to hear" is the language you understand, normally ${mine}.`,
        tone: 'warn',
        fix: { label: `I want to hear ${mine}`, listenLang: me.spokenLang },
      }
    }
    return { text: `Same language (${mine}): nothing to translate.`, tone: 'info' }
  }
  const hearers = status.others.filter(
    (o) =>
      o.connected &&
      fanout.targets.some((t) => shortLanguageName(t.lang) === shortLanguageName(o.listenLang)),
  )
  const out = `You speak ${mine} → ${
    hearers.map((o) => `${o.name} hears ${shortLanguageName(o.listenLang)}`).join(', ') ||
    fanout.targets.map((t) => shortLanguageName(t.lang)).join(', ')
  }`
  const incoming = status.incoming.filter((i) => i.translated)
  const inn = incoming.length
    ? ` · You hear ${incoming.map((i) => `${i.name} in ${shortLanguageName(i.to)}`).join(', ')}`
    : ''
  return { text: out + inn, tone: 'ok' }
}

export function TranslationStatusLine({
  status,
  onFix,
}: {
  status: TranslationStatus | null
  onFix: (listenLang: string) => void
}) {
  const line = describeTranslation(status)
  const color =
    line.tone === 'ok'
      ? 'text-cyan-200'
      : line.tone === 'warn'
        ? 'text-amber-200'
        : 'text-slate-400'
  return (
    <p data-testid="translation-status" className={`mt-1 text-xs leading-4 ${color}`}>
      {line.text}
      {line.fix && (
        <button
          type="button"
          onClick={() => onFix(line.fix!.listenLang)}
          className="ml-2 font-semibold underline underline-offset-2"
        >
          {line.fix.label}
        </button>
      )}
    </p>
  )
}
