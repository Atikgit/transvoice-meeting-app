import { notFound } from 'next/navigation'
import { RoomPreview as Preview } from './preview'

/**
 * Development-only preview of the meeting room layout with fake data, used by the Playwright
 * layout checks (tests/e2e/meeting-layout.spec.ts). 404 in production builds.
 *
 *   /dev/room?role=host|guest&state=ready|live
 */
export default async function RoomPreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { role: roleParam, state } = await searchParams
  const role = roleParam === 'guest' ? 'guest' : 'host'
  const live = state === 'live'
  return <Preview role={role} live={live} />
}
