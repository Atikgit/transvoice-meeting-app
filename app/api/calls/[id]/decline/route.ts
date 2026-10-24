import { answer } from '@/lib/meetings/answer'

/** POST /api/calls/[id]/decline — the callee declines a ringing call. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return answer(params, false)
}
