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
> data (see `docs/PROMPT.md` §13).

After applying, regenerate the TypeScript types so new tables are typed:

```sh
pnpm db:types
```

## 2. Authentication settings

Supabase → Authentication:

| Setting                                         | Value                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign In / Providers → Email → **Confirm email** | **On.** Trial minutes are granted on confirmation.                                                                                          |
| URL Configuration → **Site URL**                | Production URL, e.g. `https://app.transvoice.example`                                                                                       |
| URL Configuration → **Redirect URLs**           | `https://<prod-domain>/auth/callback`, `https://*-<vercel-team>.vercel.app/auth/callback` (previews), `http://localhost:3000/auth/callback` |

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
