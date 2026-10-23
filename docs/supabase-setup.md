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

### Email templates

Authentication → Emails → Templates. Both links use the token hash (not `{{ .ConfirmationURL }}`),
so they work on any device or browser: `/auth/confirm` verifies the token, then redirects.
Inline styles and tables only (email clients ignore stylesheets and gradients, so " AI" is solid
`#F5B800` here). The logo must stay reachable at `https://meet.transvoice.ai/brand/logo-192.png`.

**Confirm signup**, subject `Confirm your TransVoice AI account`:

```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0b0e16;">
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      bgcolor="#0b0e16"
      style="background:#0b0e16;"
    >
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="max-width:480px;"
          >
            <tr>
              <td style="padding:0 0 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;">
                      <img
                        src="https://meet.transvoice.ai/brand/logo-192.png"
                        width="40"
                        height="40"
                        alt="TransVoice AI"
                        style="display:block;border-radius:10px;"
                      />
                    </td>
                    <td
                      style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-weight:700;letter-spacing:3px;color:#67e8f9;"
                    >
                      TRANSVOICE<span style="color:#F5B800;"> AI</span>
                      <div
                        style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:400;letter-spacing:0;color:#64748b;"
                      >
                        Meet without limits
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td
                bgcolor="#151b29"
                style="background:#151b29;border:1px solid #232a3b;border-radius:20px;padding:32px;font-family:Arial,Helvetica,sans-serif;"
              >
                <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#ffffff;">
                  Confirm your email
                </h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#94a3b8;">
                  Welcome to TransVoice AI. Confirm your email to activate your account and get your
                  <strong style="color:#e2e8f0;">15 free minutes</strong> of live voice translation.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#67e8f9" style="border-radius:12px;">
                      <a
                        href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard"
                        style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:700;color:#020617;text-decoration:none;border-radius:12px;"
                        >Confirm my email</a
                      >
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#64748b;">
                  If you did not create a TransVoice AI account with {{ .Email }}, you can ignore
                  this email.
                </p>
              </td>
            </tr>
            <tr>
              <td
                style="padding:20px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#475569;"
              >
                TransVoice AI · Live voice-translated meetings in 140+ languages &amp; voices<br />
                You received this email because of an action on meet.transvoice.ai.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

**Reset Password**, subject `Reset your TransVoice AI password`:

```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0b0e16;">
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      bgcolor="#0b0e16"
      style="background:#0b0e16;"
    >
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="max-width:480px;"
          >
            <tr>
              <td style="padding:0 0 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;">
                      <img
                        src="https://meet.transvoice.ai/brand/logo-192.png"
                        width="40"
                        height="40"
                        alt="TransVoice AI"
                        style="display:block;border-radius:10px;"
                      />
                    </td>
                    <td
                      style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-weight:700;letter-spacing:3px;color:#67e8f9;"
                    >
                      TRANSVOICE<span style="color:#F5B800;"> AI</span>
                      <div
                        style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:400;letter-spacing:0;color:#64748b;"
                      >
                        Meet without limits
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td
                bgcolor="#151b29"
                style="background:#151b29;border:1px solid #232a3b;border-radius:20px;padding:32px;font-family:Arial,Helvetica,sans-serif;"
              >
                <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#ffffff;">
                  Reset your password
                </h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#94a3b8;">
                  Someone asked to reset the password for your TransVoice AI account ({{ .Email }}).
                  Choose a new one with the button below.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#67e8f9" style="border-radius:12px;">
                      <a
                        href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset"
                        style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:700;color:#020617;text-decoration:none;border-radius:12px;"
                        >Choose a new password</a
                      >
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#64748b;">
                  The link works once and expires in 1 hour. If you did not ask for this, ignore
                  this email: your password stays the same.
                </p>
              </td>
            </tr>
            <tr>
              <td
                style="padding:20px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#475569;"
              >
                TransVoice AI · Live voice-translated meetings in 140+ languages &amp; voices<br />
                You received this email because of an action on meet.transvoice.ai.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

After confirmation the user lands on `/dashboard` (or back on the invite page they signed up
from, remembered in a cookie). The reset link opens a recovery session and leads to `/auth/reset`
(new password, min. 8 characters), then `/dashboard`. Expired or already-used links show a
specific message on `/login` or `/forgot-password`.

Optional, same layout: **Change Email Address** with
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/dashboard/settings`, and
**Invite user** with `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (leads to
`/auth/reset` to choose a password).

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
