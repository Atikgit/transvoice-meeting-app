import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { as, createTestDb, createUser } from './harness'
import { addSponsoredGuest, newCall, type Call } from './meter-world'

let db: PGlite
let host: string
let guest: string
let call: Call

beforeEach(async () => {
  db = await createTestDb()
  host = await createUser(db, 'host@example.com')
  guest = await createUser(db, 'guest@example.com')
  call = await newCall(db, host)
  await addSponsoredGuest(db, call, guest)
  await db.query(
    `update public.call_sessions set status = 'live', started_at = now() where id = $1`,
    [call.sessionId],
  )
}, 30_000)

/** An open segment whose join and last heartbeat were `joinedAgo` / `beatAgo` seconds ago. */
const openSegment = (user: string, joinedAgo: number, beatAgo: number) =>
  db.query(
    `insert into public.participant_segments
       (session_id, user_id, payer_id, connected_at, last_heartbeat_at)
     select $1, $2, payer_id, now() - make_interval(secs => $3), now() - make_interval(secs => $4)
     from public.meeting_participants where session_id = $1 and user_id = $2`,
    [call.sessionId, guest, joinedAgo, beatAgo],
  )

const heartbeat = async (user = guest) =>
  (
    await db.query<{ r: string }>('select public.record_heartbeat($1, $2) r', [
      call.sessionId,
      user,
    ])
  ).rows[0]!.r

const segments = async () =>
  (
    await db.query<{ age: number; open: boolean }>(
      `select extract(epoch from now() - last_heartbeat_at)::int age, disconnected_at is null open
       from public.participant_segments where session_id = $1 and user_id = $2
       order by connected_at`,
      [call.sessionId, guest],
    )
  ).rows

describe('record_heartbeat', () => {
  it('moves last_heartbeat_at of the open segment to now (25 s old → 0 s old)', async () => {
    await openSegment(guest, 100, 25)
    expect((await segments())[0]!.age).toBe(25)
    expect(await heartbeat()).toBe('ok')
    expect(await segments()).toEqual([{ age: 0, open: true }])
  })

  it('a heartbeat after more than 45 s of silence closes the old segment at hb+45 s and opens a new one', async () => {
    await openSegment(guest, 300, 120) // silent for 120 s
    expect(await heartbeat()).toBe('reconnected')
    const rows = await db.query<{ billed_gap: number; open: boolean }>(
      `select extract(epoch from disconnected_at - (now() - interval '120 seconds'))::int billed_gap,
              disconnected_at is null open
       from public.participant_segments where session_id = $1 and user_id = $2 order by connected_at`,
      [call.sessionId, guest],
    )
    // The old segment ends 45 s after its last heartbeat, not now; the new one is open.
    expect(rows.rows[0]).toEqual({ billed_gap: 45, open: false })
    expect(rows.rows[1]!.open).toBe(true)
  })

  it('returns no_segment without an open segment and session_closed for an ended session', async () => {
    expect(await heartbeat()).toBe('no_segment')
    await openSegment(guest, 100, 5)
    await db.query(
      `update public.call_sessions set status = 'ended', ended_at = now() where id = $1`,
      [call.sessionId],
    )
    expect(await heartbeat()).toBe('session_closed')
  })

  it("only touches the caller's own segment", async () => {
    await openSegment(guest, 100, 30)
    expect(await heartbeat(host)).toBe('no_segment')
    expect((await segments())[0]!.age).toBe(30)
  })

  it('is service role only', async () => {
    await expect(
      as(db, 'authenticated', guest, (tx) =>
        tx.query('select public.record_heartbeat($1, $2)', [call.sessionId, guest]),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('join webhook after a crashed tab', () => {
  const join = (at: string) =>
    db.query(
      `select public.record_livekit_event($1, 'participant_joined', $2, $3, $4::timestamptz)`,
      [`EV_${at}`, call.sessionId, guest, at],
    )

  it('does not revive a silent open segment: it is closed at hb+45 s and a new one opens', async () => {
    await openSegment(guest, 600, 300) // crashed 5 minutes ago, never closed
    await join(new Date().toISOString())
    const rows = await db.query<{ open: boolean; secs: number | null }>(
      `select disconnected_at is null open,
              extract(epoch from disconnected_at - last_heartbeat_at)::int secs
       from public.participant_segments where session_id = $1 and user_id = $2 order by connected_at`,
      [call.sessionId, guest],
    )
    expect(rows.rows).toEqual([
      { open: false, secs: 45 },
      { open: true, secs: null },
    ])
  })

  it('keeps a recently active segment (the repeated join of the existing test)', async () => {
    await openSegment(guest, 600, 10)
    await join(new Date().toISOString())
    expect(await segments()).toHaveLength(1)
  })
})
