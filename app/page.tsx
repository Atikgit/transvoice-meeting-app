export const dynamic = 'force-dynamic'
import { randomBytes } from 'node:crypto'
import { AppShell, type Screen } from '@/components/app/app-shell'

function initialScreen(view: unknown): Screen {
  return view === 'join' || view === 'meeting' ? view : 'dashboard'
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { room, view } = await searchParams

  return (
    <AppShell
      initialRoomId={
        typeof room === 'string' && room ? room : `room-${randomBytes(4).toString('hex')}`
      }
      initialScreen={initialScreen(view)}
    />
  )
}
