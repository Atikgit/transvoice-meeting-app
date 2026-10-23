import { BRAND } from '@/lib/brand'

/**
 * "TRANSVOICE AI": primary part in the cyan mono style, " AI" in gold with a subtle gradient
 * (solid #F5B800 where background-clip: text is unsupported). Screen readers get the plain name.
 */
export function BrandWordmark({ className = 'text-[10px]' }: { className?: string }) {
  return (
    <span className={`font-mono font-bold tracking-[.22em] ${className}`}>
      <span className="sr-only">{BRAND.name}</span>
      <span aria-hidden="true">
        <span className="text-cyan-300">{BRAND.wordmark.primary}</span>{' '}
        <span className="bg-gradient-to-b from-[#FFD54A] to-[#E0A100] bg-clip-text text-[#F5B800] supports-[background-clip:text]:text-transparent">
          {BRAND.wordmark.accent}
        </span>
      </span>
    </span>
  )
}
