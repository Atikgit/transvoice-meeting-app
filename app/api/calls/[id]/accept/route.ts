import { answer } from '@/lib/meetings/answer'

/** POST /api/calls/[id]/accept — the callee (sponsor) accepts a ringing call. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return answer(params, true)
}
