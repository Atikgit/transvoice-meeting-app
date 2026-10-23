// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '@/app/manifest'
import { BrandWordmark } from '@/components/brand/brand-wordmark'
import { Logo } from '@/components/common/logo'
import { BRAND, TITLE_TEMPLATE } from '@/lib/brand'

afterEach(cleanup)

describe('brand', () => {
  it('is "TransVoice AI"', () => {
    expect(BRAND.name).toBe('TransVoice AI')
    expect(BRAND.appName).toBe('TransVoice AI Meet')
    expect(TITLE_TEMPLATE).toBe('%s · TransVoice AI')
    expect(manifest()).toMatchObject({ name: 'TransVoice AI Meet', short_name: 'TransVoice AI' })
  })

  it('renders TRANSVOICE in cyan and AI in gold, readable as one name', () => {
    const { container } = render(<BrandWordmark />)
    expect(screen.getByText('TransVoice AI')).toHaveClass('sr-only')
    expect(screen.getByText('TRANSVOICE')).toHaveClass('text-cyan-300')
    const ai = screen.getByText('AI')
    expect(ai.className).toContain('text-[#F5B800]')
    expect(ai.className).toContain('from-[#FFD54A]')
    expect(ai.className).toContain('to-[#E0A100]')
    expect(container.textContent).toBe('TransVoice AITRANSVOICE AI')
  })

  it('keeps the tagline next to the wordmark', () => {
    render(<Logo />)
    expect(screen.getByText('Meet without limits')).toBeInTheDocument()
  })

  it('has no hard-coded brand strings outside lib/brand.ts', () => {
    // "TransVoice" as a word (not identifiers like TransVoiceApiError) or the TRANSVOICE wordmark.
    const brand = /\bTransVoice(?![A-Za-z])|\bTRANSVOICE(?![A-Z_])/
    const files = ['app', 'components', 'features'].flatMap((dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => `${entry.parentPath}/${entry.name}`),
    )
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => brand.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)),
    )
    expect(offenders).toEqual([])
  })
})
