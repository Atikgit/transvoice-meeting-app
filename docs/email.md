# Invite email (Brevo)

## Why "Send Invite" did not send (measured on this host)

| Check                                                                | Result                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Variable names in `.env.production`                                  | `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` — the names the code reads |
| Same names inside the running container                              | **none present**                                                                        |
| Container created / `.env.production` edited                         | 09:27 / 10:17 — the file was edited **after** the container was created                 |
| Boot log of that container                                           | `{"event":"mailer","configured":false,"kind":"none"}`                                   |
| Brevo SMTP login from this host (`transport.verify()`, no mail sent) | `smtp-relay.brevo.com:587` AUTH OK, with and without `requireTLS`                       |

**Root cause: the container was not recreated.** `env_file` is read only when the container is created;
`docker restart` does not re-read it. Run `docker compose --env-file .env.production up -d --build`
(or `up -d --force-recreate`) and the boot log must say `"configured":true,"kind":"smtp"`.

Not provable without sending a message: that `EMAIL_FROM` (`…@transvoice.ai`) is a **verified sender /
authenticated domain in Brevo** (Brevo → Senders, Domains & dedicated IPs). If it is not, Brevo refuses the
message; the modal then says "The sender address is not verified…" and the log shows `failure":"sender"`.
Note: `.env.production` line `EMAIL_FROM=TransVoice AI <no-reply@…>` is fine for Docker and Node but cannot be
`source`d by a shell; quote it if you ever do.

## Setup

- SMTP (default): `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS, required:
  nodemailer is configured with `requireTLS` on 587), `SMTP_USER`, `SMTP_PASS` (Brevo SMTP key), `EMAIL_FROM`.
- HTTPS API (optional): `BREVO_API_KEY` — `POST https://api.brevo.com/v3/smtp/email` with header `api-key`.
  When set it wins over Resend and SMTP (useful if port 587 is blocked: it uses 443).
- The boot log (`{"event":"mailer",…}`) says which transport is active; never keys.

## Behaviour of Send Invite

Only the signed-in creator of an invitation that is still usable; address format checked (no line breaks);
10 emails/hour per user (and 20/hour per IP), 3/day per recipient; inviter name escaped in HTML and stripped of
CR/LF in the subject; recipient addresses and bodies are never logged; the modal shows a masked address
(`p••••@example.com`). Provider errors are mapped to: wrong credentials, sender not verified, sending limit
reached, service unreachable, refused. The server log has `failure` (auth|sender|quota|network|rejected).

## Test

`pnpm mail:test you@example.com` — sends one message through the same transport (reads `.env.production`),
prints the transport and the provider's answer (and what it means), never the address or keys.
