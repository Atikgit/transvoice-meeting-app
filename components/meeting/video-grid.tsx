import type { ReactNode } from 'react'

/** Columns for n tiles: 1–2 side by side, then roughly square grids (3–4 → 2, 5–6 → 3, 7–8 → 4). */
export function gridColumns(count: number): number {
  if (count <= 2) return Math.max(count, 1)
  if (count <= 4) return 2
  if (count <= 6) return 3
  return 4
}

// Mobile picture-in-picture (classes beat the inline desktop width with !important).
const STAGE = 'max-md:absolute max-md:inset-0 max-md:!w-auto max-md:aspect-auto'
const PIP =
  'max-md:absolute max-md:right-3 max-md:bottom-3 max-md:z-10 max-md:!w-28 max-md:aspect-[3/4] max-md:shadow-2xl'

/**
 * Fits 16:9 tiles into the available height and width without scrolling: each tile is as large
 * as both the row height and the column width allow (container query units), centered.
 */
export function VideoGrid({
  children,
  pip = false,
}: {
  children: ReactNode[]
  /**
   * Two tiles: below 768px the first (partner) fills the area and the second (self) floats as
   * a small picture-in-picture in the corner.
   */
  pip?: boolean
}) {
  const tiles = children.filter(Boolean)
  const cols = gridColumns(tiles.length)
  const rows = Math.ceil(tiles.length / cols)
  // gap-4 = 1rem between tiles.
  const width = `min(calc((100cqw - ${cols - 1}rem) / ${cols}), calc((100cqh - ${rows - 1}rem) / ${rows} * 16 / 9))`
  const mobilePip = pip && tiles.length === 2

  return (
    <div
      data-testid="video-grid"
      className={`flex h-full w-full flex-wrap content-center items-center justify-center gap-4 [container-type:size] ${mobilePip ? 'max-md:relative max-md:block' : ''}`}
    >
      {tiles.map((tile, index) => (
        <div
          key={index}
          data-testid={mobilePip ? (index === 0 ? 'stage-tile' : 'pip-tile') : undefined}
          className={`aspect-video ${mobilePip ? (index === 0 ? STAGE : PIP) : ''}`}
          style={{ width }}
        >
          {tile}
        </div>
      ))}
    </div>
  )
}
