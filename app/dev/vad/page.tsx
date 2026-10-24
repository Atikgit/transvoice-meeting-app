import { notFound } from 'next/navigation'
import { VadProbe } from './probe'

/**
 * Development-only: runs the real voice activity detector on the browser's (fake) microphone
 * and reports its state, for tests/e2e/vad.spec.ts. 404 in production builds.
 */
export default function VadPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <VadProbe />
}
