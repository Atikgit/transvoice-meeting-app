import { redirect } from 'next/navigation'

// No landing page yet (Phase 7): the legacy single-page shell is retired, so "/" opens the
// dashboard (or the login page when signed out).
export default function Home() {
  redirect('/dashboard')
}
