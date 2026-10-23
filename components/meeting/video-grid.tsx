import type { ReactNode } from 'react'

/** Columns for n tiles: 1–2 side by side, then roughly square grids (3–4 → 2, 5–6 → 3, 7–8 → 4). */
export function gridColumns(count: number): number {
  if (count <= 2) return Math.max(count, 1)
  if (count <= 4) return 2
  if (count <= 6) return 3
  return 4
}

/**
 * Fits 16:9 tiles into the available height and width without scrolling: each tile is as large
 * as both the row height and the column width allow (container query units), centered.
 */
export function VideoGrid({ children }: { children: ReactNode[] }) {
  const tiles = children.filter(Boolean)
  const cols = gridColumns(tiles.length)
  const rows = Math.ceil(tiles.length / cols)
  // gap-4 = 1rem between tiles.
  const width = `min(calc((100cqw - ${cols - 1}rem) / ${cols}), calc((100cqh - ${rows - 1}rem) / ${rows} * 16 / 9))`

  return (
    <div
      data-testid="video-grid"
      className="flex h-full w-full flex-wrap content-center items-center justify-center gap-4 [container-type:size]"
    >
      {tiles.map((tile, index) => (
        <div key={index} className="aspect-video" style={{ width }}>
          {tile}
        </div>
      ))}
    </div>
  )
}
