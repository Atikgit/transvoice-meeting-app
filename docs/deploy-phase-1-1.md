# Deploying Phase 1.1

Branch `phase-1.1` → `main`, then the Hetzner server. Same order as Phase 1: database, Supabase
dashboard, code.

## 1. Migrations on `uvgcaedyalkzsqykdhaw`

New files (all additive, service-role functions only):

| File                                    | What it does                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `20261022000700_legacy_trigger_cleanup` | Drops any surviving v0 signup trigger on `auth.users`; Phase 1 triggers call `ensure_user_account` |
| `20261023000100_invitations`            | `create_invitation()`, `accept_invitation()`                                                       |
| `20261023000200_create_meeting`         | `create_meeting()`                                                                                 |
| `20261023000300_call_sessions`          | `start_call_session()`, `join_call_session()`, `end_call_session()`                                |

`20261022000000` was also hardened, but a database where it already ran will not run it again;
`0700` carries the same cleanup. From a checkout of `phase-1.1`:

```sh
pnpm dlx supabase link --project-ref uvgcaedyalkzsqykdhaw
pnpm dlx supabase migration list   # 0000–0600 applied by your earlier push
pnpm dlx supabase db push          # applies 0700 and the three 20261023 files
```

### Verify

```sql
-- Only the two Phase 1 triggers remain on auth.users.
select t.tgname, p.oid::regprocedure
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
-- expected: on_auth_user_created → private.handle_new_user()
--           on_auth_user_email_confirmed → private.handle_user_email_confirmed()

-- No legacy functions left.
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ilike '%minutes_balance%';   -- expected: 0 rows

-- Every verified user has exactly one 15-minute trial credit.
select u.email, b.trial_minutes_remaining,
       (select count(*) from public.usage_ledger l
         where l.payer_id = u.id and l.reason = 'free_trial') as trial_credits
from auth.users u left join public.billing_accounts b on b.user_id = u.id
order by u.created_at;
-- expected: 15.0000 and 1 for verified users (0 / 0 until an email is confirmed)
```

## 2. Supabase dashboard

Authentication → Emails → Templates: paste the **Confirm signup** and **Reset Password**
templates from [supabase-setup.md](supabase-setup.md#email-templates) (token-hash links to
`/auth/confirm`, branded TransVoice AI). Subjects: `Confirm your TransVoice AI account`,
`Reset your TransVoice AI password`. Redirect URLs already include `/auth/callback` and
`/auth/reset`.

## 3. Environment

No new variables. `APP_URL=https://meet.transvoice.ai` must be set (invite links and auth
emails use it).

## 4. Merge and deploy

```sh
git push origin phase-1.1     # open a PR, merge into main
# on the server
cd /root/transvoice-meeting-app && git checkout main && git pull origin main && ./deploy.sh
```

## 5. Smoke test

- `/` redirects to `/dashboard` (or `/login`). `/dev/room` returns 404.
- Dashboard: **Invite Partner** next to Join with link / Start meeting → choose 7 d → link with
  Copy / WhatsApp / LinkedIn / Email. Open it in a private window: sign up → confirm email (on
  your phone, to test cross-device) → back on the invite → Accept → lobby.
- **Start meeting** → lobby ("Start Translated Meeting", name and languages prefilled, Back
  button) → room in **Ready**; press **Start** → **Live 00:01** and End meeting; the guest sees
  "Waiting for host to start…" until then.
- Expired confirmation link → `/login` "Link expired — resend" with a resend form; check
  `docker logs transvoice_meeting_app` shows `[auth/confirm] verifyOtp failed … otp_expired`.

```sql
-- Sessions and payers after a test call (guest's payer = the host while sponsored).
select cs.status, cs.started_at, cs.ended_at, mp.role, mp.payer_id = cs.host_id as host_pays
from public.call_sessions cs join public.meeting_participants mp on mp.session_id = cs.id
order by cs.created_at desc limit 10;
```

## Rollback

Redeploy the previous image. The new migrations only add functions; Phase 1 code ignores them.
