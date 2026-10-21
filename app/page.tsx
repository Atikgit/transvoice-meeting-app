import { AppShell } from '@/components/app/app-shell'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { room, view } = await searchParams

  return (
    <AppShell
      initialRoomId={typeof room === 'string' && room ? room : 'room-jbv6k9'}
      initialScreen={view === 'join' ? 'join' : 'dashboard'}
    />
  )
}
