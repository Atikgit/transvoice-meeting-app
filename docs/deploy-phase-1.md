# Deploying Phase 1

Production: `meet.transvoice.ai` on Hetzner (Docker, behind Nginx), Supabase project
**Transvoice Meeting App** (`uvgcaedyalkzsqykdhaw`). Do the steps in this order: the database
first, then env, then code.

## 1. Apply the migrations to `uvgcaedyalkzsqykdhaw`

New in this phase, after the four Phase 1 schema files (`0000`–`0300`):

| File                                    | What it does                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `20261022000400_trial_on_first_sign_in` | `ensure_user_account()`: OAuth trial on first sign-in; backfills profiles, billing accounts, trial |
| `20261022000500_profile_signup_geo`     | `country_code`, `country_name`, `signup_ip_hash`, `signup_at` (server-only), `record_signup_geo()` |
| `20261022000600_language_codes`         | Allows locales such as `sr-Latn-RS` and `zh-CN-sichuan` in `spoken_lang` / `listen_lang`           |

First check what is already applied (Supabase → SQL Editor):

```sql
select to_regclass('public.billing_accounts') is not null as phase1_schema_applied,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles'
                 and column_name = 'minutes_balance') as legacy_profiles_present;
```

Then, from a checkout of `phase-1` on your machine:

```sh
pnpm dlx supabase login
pnpm dlx supabase link --project-ref uvgcaedyalkzsqykdhaw
pnpm dlx supabase migration list          # what the CLI thinks is applied
```

- **`phase1_schema_applied = false`** (expected): `pnpm dlx supabase db push`. It runs all
  seven files in order. `0000` drops the legacy `profiles` / `minutes_balance` /
  `add_user_minutes` / `deduct_user_minutes` (approved: test users only); `0400` backfills both
  users.
- **`phase1_schema_applied = true` but `migration list` shows `0000`–`0300` as not applied**
  (they were pasted into the SQL Editor earlier): mark them applied first, then push the rest:

  ```sh
  pnpm dlx supabase migration repair --status applied 20261022000000 20261022000100 20261022000200 20261022000300
  pnpm dlx supabase db push
  ```

Without the CLI, paste each file into the SQL Editor in filename order instead.

### Verify: both users have 15 trial minutes

```sql
select u.email,
       u.email_confirmed_at is not null                    as verified,
       coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider,
       b.trial_minutes_remaining,
       b.prepaid_minutes_remaining,
       b.billing_type,
       b.plan
from auth.users u
left join public.billing_accounts b on b.user_id = u.id
order by u.created_at;
```

Expected: both rows `verified = true`, `trial_minutes_remaining = 15.0000`,
`prepaid_minutes_remaining = 0.0000`, `billing_type = free`, `plan = trial`. If a row shows 0:

```sql
-- Who received a trial? (One per normalized email: lowercase, +tag removed, Gmail dots ignored.)
select g.user_id, u.email, g.granted_at
from private.trial_grants g left join auth.users u on u.id = g.user_id;

select payer_id, kind, reason, billed_minutes, created_at
from public.usage_ledger order by created_at;
```

- `verified = false` → that address never confirmed; it gets 15 min on confirmation.
- Both addresses normalize to the same email (e.g. `jane.doe@gmail.com` and
  `janedoe+test@gmail.com`) → only the first gets the trial. That is the anti-abuse rule working.

## 2. Supabase dashboard

Authentication → URL Configuration and Emails, as in [supabase-setup.md](supabase-setup.md) §2:

- Site URL `https://meet.transvoice.ai`. Redirect URLs include
  `https://meet.transvoice.ai/auth/callback` and `https://meet.transvoice.ai/auth/reset`.
- **Confirm signup** and **Reset Password** templates (token-hash links via `/auth/confirm`).
- Custom SMTP before real users arrive (the built-in sender allows only a few emails per hour).

## 3. New variables in `.env.production` (on the server)

```sh
# Auth email links (password reset, confirmation, OAuth)
APP_URL=https://meet.transvoice.ai
# Signup IP hash salt: generate once, never change (openssl rand -hex 32)
IP_HASH_SALT=<64 hex chars>
# Already present: GeoLite2 download at image build
MAXMIND_LICENSE_KEY=<your key>
# Optional: change (e.g. 2026-11) to force a fresh GeoLite2 download on the next build
GEOIP_REFRESH=
```

`MAXMIND_LICENSE_KEY` is a **build arg**. Docker Compose fills `${MAXMIND_LICENSE_KEY}` in
`docker-compose.yml` from the shell or `--env-file`, not from `env_file:`. `deploy.sh` must
therefore build the way it already does for the `NEXT_PUBLIC_*` args, for example
`docker compose --env-file .env.production up -d --build`. Without the key the build still
succeeds and signups store a null country.

Rate limits (password reset and resend confirmation: 5/hour per IP and per email) work without
Upstash: they fall back to process memory, which is fine for the single container. Set
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` to share them across instances.

## 4. Merge to `main`

Open a PR from `phase-1` and merge it (CI: `pnpm typecheck && pnpm lint && pnpm test`).

## 5. Deploy on the server

```sh
cd /path/to/transvoice-meeting-app
git pull origin main
./deploy.sh
```

`docker-compose.yml` now publishes the container on **`127.0.0.1:3003`** only, so it is no
longer reachable from the internet directly. Nginx must proxy to `http://127.0.0.1:3003`, and set
both `X-Forwarded-For` and `X-Real-IP`. The app trusts those headers for the signup country only
because nothing else can reach the port. Compose recreates the container because the port binding
changed.

### Smoke test

```sh
docker exec transvoice_meeting_app ls -la /app/geoip          # GeoLite2-Country.mmdb present
docker logs transvoice_meeting_app 2>&1 | grep -i geoip       # no "GeoIP database unavailable"
curl -sI https://meet.transvoice.ai/favicon.ico | head -1     # 200
curl -s  https://meet.transvoice.ai/manifest.webmanifest      # "name":"TransVoice Meet"
curl -sI https://meet.transvoice.ai/forgot-password | head -1 # 200
# From another machine: the app port must not answer
curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://<server-public-ip>:3003/  # 000
```

In the browser: sign in with each test user, check that `/dashboard` shows **15 min remaining**,
then try **Forgot password?** end to end. After a Google/LinkedIn sign-in or an email
confirmation, check that the signup country was recorded:

```sql
select id, country_code, country_name, signup_ip_hash is not null as hashed, signup_at
from public.profiles order by signup_at desc nulls last;
```

## Rollback

Redeploy the previous image or commit. Migrations `0400`–`0600` are additive and the Phase 0 code
works with them. `0000` (legacy drop) cannot be undone, which is acceptable with test data only.
