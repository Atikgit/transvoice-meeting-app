/**
 * The mail transports behind the app's branded emails (Resend's HTTPS API or SMTP via nodemailer),
 * free of app imports so the same code runs in the server and in `pnpm mail:test`
 * (scripts/mail-test.ts). Never logs or returns recipients or message bodies.
 */
import nodemailer from 'nodemailer'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
}

export interface MailConfig {
  from: string
  resendApiKey?: string
  smtp?: { host?: string; port: number; secure: boolean; user?: string; pass?: string }
}

export type MailTransport = {
  kind: 'resend' | 'smtp'
  send: (email: OutgoingEmail) => Promise<void>
}

export type MailerStatus =
  | { configured: true; kind: 'resend' | 'smtp' }
  | {
      configured: false
      kind: 'none'
      /** Names (never values) of the variables that would complete a started SMTP setup. */
      missing: string[]
    }

/** What is configured, for the boot log and the clear error in the modal. */
export function mailerStatus(config: MailConfig): MailerStatus {
  if (config.resendApiKey) return { configured: true, kind: 'resend' }
  const smtp = config.smtp
  const missing = smtp
    ? [
        ...(smtp.host ? [] : ['SMTP_HOST']),
        ...(smtp.user ? [] : ['SMTP_USER']),
        ...(smtp.pass ? [] : ['SMTP_PASS']),
      ]
    : ['RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS']
  if (smtp && missing.length === 0) return { configured: true, kind: 'smtp' }
  // Only report a half-finished SMTP setup by name; with nothing set, say what to set.
  const started = Boolean(smtp?.host || smtp?.user || smtp?.pass)
  return {
    configured: false,
    kind: 'none',
    missing: started ? missing : ['RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS'],
  }
}

export function createMailTransport(config: MailConfig): MailTransport | null {
  const status = mailerStatus(config)
  if (!status.configured) return null

  if (status.kind === 'resend') {
    const key = config.resendApiKey!
    return {
      kind: 'resend',
      send: async (email) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.from, ...email }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
          // Resend explains itself ("domain is not verified", "API key is invalid"): keep that
          // sentence, never the request.
          const reason = (await res.json().catch(() => null)) as { message?: string } | null
          throw new Error(
            `Resend responded ${res.status}${reason?.message ? `: ${String(reason.message).slice(0, 160)}` : ''}`,
          )
        }
      },
    }
  }

  const smtp = config.smtp!
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return {
    kind: 'smtp',
    send: async (email) => {
      try {
        await transport.sendMail({ from: config.from, ...email })
      } catch (error) {
        // nodemailer messages carry the SMTP reply ("535 Authentication failed"), not the mail.
        const e = error as { code?: string; responseCode?: number; message?: string }
        throw new Error(
          `SMTP ${e.code ?? 'error'}${e.responseCode ? ` ${e.responseCode}` : ''}: ${String(e.message ?? '').slice(0, 160)}`,
        )
      }
    },
  }
}
