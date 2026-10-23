# Supabase setup

What has to be configured in the Supabase project for the app to work. Do these once per
project (production, and any separate staging project).

## 1. Apply the migrations

The migrations live in `supabase/migrations/` and run in filename order.

**Option A, Supabase CLI** (recommended):

```sh
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <your-project-ref>
pnpm dlx supabase db push
```

**Option B, SQL editor:** paste each file, in order, into Supabase → SQL Editor and run it.

> `20261022000000_drop_legacy_schema.sql` drops the MVP `profiles` table and the
> `add_user_minutes` / `deduct_user_minutes` functions. Only run it if the existing data is test
> data (approved for production, see `docs/PROMPT.md` §13). `20261022000400` then backfills every
> existing user. Production deploy order and checks: [deploy-phase-1.md](deploy-phase-1.md).

Check that only the Phase 1 signup triggers remain on `auth.users` (expected:
`on_auth_user_created → private.handle_new_user()` and
`on_auth_user_email_confirmed → private.handle_user_email_confirmed()`):

```sql
select t.tgname, p.oid::regprocedure
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
```

After applying, regenerate the TypeScript types so new tables are typed:

```sh
pnpm db:types
```

## 2. Authentication settings

Supabase → Authentication:

| Setting                                         | Value                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign In / Providers → Email → **Confirm email** | **On.** Trial minutes are granted on confirmation.                                                                                                                  |
| URL Configuration → **Site URL**                | `https://meet.transvoice.ai`                                                                                                                                        |
| URL Configuration → **Redirect URLs**           | `https://meet.transvoice.ai/auth/callback`, `https://meet.transvoice.ai/auth/reset`, `https://*-<vercel-team>.vercel.app/**` (previews), `http://localhost:3000/**` |

The app sends `APP_URL` (`https://meet.transvoice.ai` in production) as the redirect target of
every auth email, so it must match an allow-listed URL.

**SMTP:** Supabase's built-in email sender is limited to a few messages per hour for the whole
project and is meant for testing. Before launch, set Authentication → Emails → **SMTP Settings**
to a real provider (Resend, Postmark, SES…), then raise Authentication → Rate Limits → email
sending. The app adds its own limits on top (password reset and resend confirmation: 5/hour per
IP and per email).

### Email template

Authentication → Emails → **Confirm signup**: change the link so confirmation works even
when the email is opened in a different browser:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard">
  Confirm your email
</a>
```

(Without this change the default link still works through `/auth/callback`, but only in the
browser that signed up.)

Authentication → Emails → **Reset Password** (subject: `Reset your TransVoice password`):

```html
<h2>Reset your password</h2>
<p>Someone asked to reset the password for your TransVoice Meet account ({{ .Email }}).</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset">
    Choose a new password
  </a>
</p>
<p>
  The link works once and expires in 1 hour. If you did not ask for this, ignore this email: your
  password stays the same.
</p>
```

`/auth/confirm` opens a recovery session and sends the user to `/auth/reset` to set the new
password (min. 8 characters), then on to `/dashboard`. Like the signup link, it works in any
browser. The default template (`{{ .ConfirmationURL }}`) also works, through
`/auth/reset?code=…`, but only in the browser that requested the reset.

## 3. OAuth providers

Each button appears only when its env flag is on **and** the provider is enabled in Supabase.

| Provider | Supabase setting                                                            | App env                      |
| -------- | --------------------------------------------------------------------------- | ---------------------------- |
| Google   | Providers → Google (client ID/secret from Google Cloud)                     | `AUTH_GOOGLE_ENABLED=true`   |
| LinkedIn | Providers → **LinkedIn (OIDC)** (client ID/secret from LinkedIn Developers) | `AUTH_LINKEDIN_ENABLED=true` |

The OAuth callback URL to register with Google and LinkedIn is
`https://<project-ref>.supabase.co/auth/v1/callback`.

## 4. Free trial amount

Stored in the database, not in env:

```sql
update private.app_settings set value = '15' where key = 'free_trial_minutes';
```

If you change it, also change `FREE_TRIAL_MINUTES` in `lib/billing/config.ts` (it is used in UI
text, and a test checks that the two match).

## 5. Lemon Squeezy webhook

Lemon Squeezy → Settings → Webhooks: URL `https://<domain>/api/lemonsqueezy/webhook`, signing
secret = `LEMONSQUEEZY_WEBHOOK_SECRET`. Events: `subscription_created`, `subscription_updated`,
`subscription_payment_success`.
