import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'

/**
 * Builders for the minute-meter DB tests: a call between named people with explicit connected
 * intervals, so every expectation can be written as plain numbers.
 */
export interface Call {
  meetingId: string
  sessionId: string
  host: string
}

/** A ready session of the host's meeting (the host is admitted as host and their own payer). */
export async function newCall(db: PGlite, host: string): Promise<Call> {
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const { rows } = await db.query<{ meeting_id: string }>(
    `select meeting_id from public.create_invitation($1, $2, '7 days', null)`,
    [host, hash],
  )
  const meetingId = rows[0]!.meeting_id
  const opened = await db.query<{ session_id: string }>(
    'select * from public.open_call_session($1, $2)',
    [meetingId, host],
  )
  const sessionId = opened.rows[0]!.session_id
  await db.query('select * from public.admit_participant($1, $2)', [sessionId, host])
  return { meetingId, sessionId, host }
}

/** The host invited this guest (sponsored connection); the guest is admitted, payer = host. */
export async function addSponsoredGuest(db: PGlite, call: Call, guest: string): Promise<void> {
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex')
  await db.query(`select * from public.create_invitation($1, $2, '7 days', null)`, [
    call.host,
    hash,
  ])
  await db.query('select public.accept_invitation($1, $2)', [hash, guest])
  await db.query('select * from public.admit_participant($1, $2)', [call.sessionId, guest])
}

/** `sponsor` (already in the room) invited `guest` to this meeting: the sponsor is the guest's payer. */
export async function addGuestOf(
  db: PGlite,
  call: Call,
  sponsor: string,
  guest: string,
): Promise<void> {
  await db.query(
    `insert into public.sponsored_connections (sponsor_id, guest_id, meeting_id, expires_at)
     values ($1, $2, $3, now() + interval '7 days')`,
    [sponsor, guest, call.meetingId],
  )
  await db.query('select * from public.admit_participant($1, $2)', [call.sessionId, guest])
}

/** A person who pays for themselves (no valid invitation): admitted as a plain guest. */
export async function addSelfPayer(db: PGlite, call: Call, user: string): Promise<void> {
  // Rights to enter the meeting without a sponsor: an expired-nothing connection is not enough,
  // so the test inserts the meeting_participants row the way admit_participant would.
  await db.query(
    `insert into public.meeting_participants (session_id, user_id, role, payer_id, spoken_lang, listen_lang)
     select $1, $2, 'guest', $2, p.spoken_lang, p.listen_lang from public.profiles p where p.id = $2`,
    [call.sessionId, user],
  )
}

export async function setLangs(
  db: PGlite,
  call: Call,
  user: string,
  spoken: string,
  listen: string,
): Promise<void> {
  await db.query(
    `update public.meeting_participants set spoken_lang = $3, listen_lang = $4
     where session_id = $1 and user_id = $2`,
    [call.sessionId, user, spoken, listen],
  )
}

/** The base minute of every test: buckets are [T0 + n min, T0 + (n+1) min). */
export const T0 = '2026-11-02T10:00:00Z'

export function at(offsetSeconds: number): string {
  return new Date(Date.parse(T0) + offsetSeconds * 1000).toISOString()
}

/**
 * One connected segment, offsets in seconds from T0. `to = null` leaves it open; `heartbeat`
 * (offset) sets last_heartbeat_at, default = the end (or the start when open).
 */
export async function connect(
  db: PGlite,
  call: Call,
  user: string,
  from: number,
  to: number | null,
  { heartbeat }: { heartbeat?: number } = {},
): Promise<void> {
  const payer = (
    await db.query<{ payer_id: string }>(
      'select payer_id from public.meeting_participants where session_id = $1 and user_id = $2',
      [call.sessionId, user],
    )
  ).rows[0]!.payer_id
  await db.query(
    `insert into public.participant_segments
       (session_id, user_id, payer_id, connected_at, disconnected_at, last_heartbeat_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      call.sessionId,
      user,
      payer,
      at(from),
      to === null ? null : at(to),
      at(heartbeat ?? to ?? from),
    ],
  )
}

/** Moves the cursor to T0 + offset seconds (tests start from a known minute). */
export async function setCursor(db: PGlite, offsetSeconds = 0): Promise<void> {
  await db.query('update private.billing_cursor set last_bucket_end = $1', [at(offsetSeconds)])
}

export interface TickResult {
  skipped?: boolean
  reason?: string
  buckets: number
  rows: number
  minutes_debited: number
  minutes_accrued: number
  shortfall_minutes: number
  payers_touched: number
  [key: string]: unknown
}

/** Runs the tick as if "now" were T0 + untilSeconds + 70 s (the default lag). */
export async function tick(db: PGlite, untilSeconds: number): Promise<TickResult> {
  const { rows } = await db.query<{ r: TickResult }>(
    'select public.apply_minute_tick($1::timestamptz) r',
    [at(untilSeconds)],
  )
  return rows[0]!.r
}

export async function ledger(db: PGlite, payer?: string) {
  const { rows } = await db.query<{
    payer_id: string
    participant_id: string
    minute_bucket: string
    lang_multiplier: number
    billed: string
    seconds: string
    trial: string
    sub: string
    shortfall: string
    kind: string
  }>(
    `select payer_id, participant_id, minute_bucket, lang_multiplier,
            billed_minutes billed, billable_seconds seconds, trial_minutes trial,
            prepaid_minutes sub, shortfall_minutes shortfall, kind
     from public.usage_ledger
     where session_id is not null and ($1::uuid is null or payer_id = $1)
     order by minute_bucket, payer_id, participant_id`,
    [payer ?? null],
  )
  return rows.map((r) => ({
    ...r,
    billed: Number(r.billed),
    seconds: Number(r.seconds),
    trial: Number(r.trial),
    sub: Number(r.sub),
    shortfall: Number(r.shortfall),
  }))
}

export const totalBilled = async (db: PGlite, payer: string) =>
  (await ledger(db, payer)).reduce((sum, r) => sum + r.billed, 0)
