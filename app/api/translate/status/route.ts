import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { connectedIdentities } from '@/lib/livekit/connected'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { translationGate } from '@/lib/translation/gate'
import { looksSwapped, planFanout } from '@/lib/translation/plan'
import { probeApiAuth } from '@/lib/transvoice/probe'

/**
 * GET /api/translate/status?sessionId=… — what live translation will do for the caller, from the
 * same stored values (meeting_participants of the open session) and the same planFanout()/gate
 * that /api/translate uses. The room shows it as its "Translating bn → en" line and the debug
 * overlay prints it. Participants of the session only; other people appear by display name and
 * language, nothing else.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const sessionId = z.uuid().safeParse(request.nextUrl.searchParams.get('sessionId'))
  if (!sessionId.success)
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: session }, { data: rows }] = await Promise.all([
    admin.from('call_sessions').select('status, host_id').eq('id', sessionId.data).maybeSingle(),
    admin
      .from('meeting_participants')
      .select(
        'user_id, role, spoken_lang, listen_lang, payer_id, profiles!meeting_participants_user_id_fkey(full_name)',
      )
      .eq('session_id', sessionId.data),
  ])
  const me = rows?.find((row) => row.user_id === user.id)
  if (!session || !rows || !me) {
    return NextResponse.json({ error: 'You are not in this meeting.' }, { status: 403 })
  }

  const env = serverEnv()
  const connected = await connectedIdentities(sessionId.data).catch(() => null)
  const others = rows
    .filter((row) => row.user_id !== user.id)
    .map((row) => ({
      userId: row.user_id,
      name: row.profiles?.full_name || 'Participant',
      role: row.role,
      spokenLang: row.spoken_lang,
      listenLang: row.listen_lang,
      // Unknown (LiveKit unreachable) is treated as connected so the line is not misleading.
      connected: connected ? connected.has(row.user_id) : true,
    }))
  const here = others.filter((other) => other.connected)

  const [{ data: host }, { data: payerHasMinutes }] = await Promise.all([
    admin.auth.admin.getUserById(session.host_id),
    admin.rpc('has_available_minutes', { p_user: me.payer_id }),
  ])
  const gate = translationGate({
    enabled: env.TRANSLATION_ENABLED,
    hostEmail: host.user?.email,
    payerHasMinutes: payerHasMinutes === true,
    speakerIsPayer: me.payer_id === user.id,
    allowlist: env.TRANSLATION_BETA_ALLOWLIST,
  })
  const plan = planFanout(
    me.spoken_lang,
    here.map((other) => ({
      userId: other.userId,
      listenLang: other.listenLang,
    })),
  )

  const partner = here[0] ?? others[0]
  return NextResponse.json(
    {
      sessionStatus: session.status,
      me: { spokenLang: me.spoken_lang, listenLang: me.listen_lang },
      others: others.map(({ userId: _id, ...rest }) => rest),
      // As a speaker: the languages my sentences are translated into (listener ids stay on the server).
      fanout: {
        reason: plan.reason,
        targets: [...plan.groups].map(([lang, listeners]) => ({
          lang,
          listeners: listeners.length,
        })),
      },
      // As a listener: what each connected person's speech becomes for me.
      incoming: here.map((other) => ({
        name: other.name,
        from: other.spokenLang,
        to: me.listen_lang,
        translated:
          planFanout(other.spokenLang, [{ userId: user.id, listenLang: me.listen_lang }]).reason ===
          'ok',
      })),
      swapped: partner
        ? looksSwapped({ spokenLang: me.spoken_lang, listenLang: me.listen_lang }, partner)
        : false,
      decision: gate.ok
        ? { allowed: true, reason: 'ok' }
        : { allowed: false, reason: gate.code, message: gate.error },
      allowlist: env.TRANSLATION_BETA_ALLOWLIST === '*' ? 'everyone' : 'list',
      translationEnabled: env.TRANSLATION_ENABLED,
      api: await probeApiAuth(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
