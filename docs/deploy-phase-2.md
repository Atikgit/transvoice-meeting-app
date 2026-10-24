# Deploying Phase 2

Phase 2 ships in three checkpoints. This file grows with each one; 2C adds the final
docker-compose and smoke-test checklist.

## Checkpoint 2A — LiveKit media and call control

### 1. Migrations (`uvgcaedyalkzsqykdhaw`)

| File                              | What it does                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `20261024000100_call_rights`      | `ready` sessions, `call_rights`, `resolve_payer`, `open_call_session`, `admit_participant`; start/end by session id |
| `20261024000200_ringing`          | `callee_id`, `create_call`, `answer_call`, `cancel_call`, `incoming_calls`; RLS for `user:<id>` Realtime channels   |
| `20261024000300_livekit_webhooks` | `record_livekit_event` (idempotent), one open `participant_segments` row per participant                            |

```sh
pnpm dlx supabase db push
```

Check the Realtime policy exists (private channels deliver nothing without it):

```sql
select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';
-- expected: "user channel: receive own"
```

### 2. Supabase dashboard

- Realtime → Settings: private channels must be allowed (they are by default). Ringing uses the
  private channel `user:<id>`; chat uses `chat:<room>` broadcast.
- Email templates: `SUPABASE_ACCESS_TOKEN=… APP_URL=https://meet.transvoice.ai pnpm auth:templates --dry-run`,
  then without `--dry-run`.

### 3. LiveKit Cloud

- Settings → Webhooks → add `https://meet.transvoice.ai/api/livekit/webhook` (signed with the
  same API key as `LIVEKIT_API_KEY`). Events used: participant_joined, participant_left,
  room_finished.
- `.env.production` already has `NEXT_PUBLIC_LIVEKIT_URL` (wss), `LIVEKIT_URL`,
  `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. `LIVEKIT_URL` may be the wss URL; the server converts
  it to https.
- `RECONNECT_GRACE_SEC` (default 60) is used for the room departure timeout and the grace check.

### 4. Env vars

No new required variables in 2A. Optional for local development: `SUPABASE_ACCESS_TOKEN` (only
for `pnpm auth:templates`, never in `.env.production`).

For the two-browser e2e test against a non-production LiveKit server:
`E2E_LIVEKIT_URL`, `E2E_LIVEKIT_API_KEY`, `E2E_LIVEKIT_API_SECRET`.

### 5. Manual test (two devices)

1. Laptop (host): dashboard → **Invite Partner** → copy link.
2. Phone (guest): open link → sign up / sign in → Accept → lobby (pick camera/mic) → Join.
   The phone shows "Waiting for host to start…".
3. Laptop: **Start meeting** → lobby → room. Both see each other's video; the speaking person
   gets a cyan ring; mute shows the mic-off icon on the other side.
4. Laptop: **Start** → both show "Live 00:0x". Try screen share and Devices (laptop).
5. Phone: toggle airplane mode for ~10 s → "Reconnecting…", then recovers. Leave it off for
   more than 60 s on the host side → session ends, "Call again" appears.
6. Ringing: phone (guest) → dashboard → Your connections → **Call** → laptop gets the
   incoming-call modal → Accept → both go to the lobby. Let it ring 30 s once → "did not answer".
7. Webhooks: after a call,
   ```sql
   select user_id, payer_id, connected_at, disconnected_at
   from public.participant_segments order by connected_at desc limit 10;
   ```
   The guest's `payer_id` is the host while the sponsorship is valid.
