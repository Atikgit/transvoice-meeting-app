import type { ComponentProps, ReactNode } from 'react'
import { CaptionBar } from '@/components/meeting/caption-bar'
import { ControlBar } from '@/components/meeting/control-bar'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { VideoGrid } from '@/components/meeting/video-grid'
import { BRAND } from '@/lib/brand'

/**
 * The room's full-height layout (header / video grid / captions / controls), independent of
 * LiveKit so it can be previewed and tested with fake data.
 */
export function MeetingLayout({
  header,
  notices,
  tiles,
  chat,
  caption,
  controls,
  children,
}: {
  header: ComponentProps<typeof MeetingHeader>
  notices?: ReactNode
  /** Partner first, self last (self becomes the mobile picture-in-picture). */
  tiles: ReactNode[]
  chat?: ReactNode
  caption: ComponentProps<typeof CaptionBar>
  controls: ComponentProps<typeof ControlBar>
  /** Modals and audio renderers. */
  children?: ReactNode
}) {
  return (
    <main className="grid h-dvh grid-rows-[auto_1fr_auto_auto] overflow-hidden bg-[#0b0e16] text-slate-100">
      <h1 className="sr-only">{BRAND.name} meeting</h1>
      <MeetingHeader {...header} />
      <section aria-label="Participants" className="relative min-h-0 px-4 pt-4 lg:px-6">
        {notices}
        <VideoGrid pip={tiles.length === 2}>{tiles}</VideoGrid>
        {chat && (
          <div className="absolute inset-0 z-30 md:inset-y-0 md:right-4 md:left-auto md:w-[340px] lg:right-6">
            {chat}
          </div>
        )}
      </section>
      <CaptionBar {...caption} />
      <ControlBar {...controls} />
      {children}
    </main>
  )
}
