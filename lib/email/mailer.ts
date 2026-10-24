import 'server-only'
import nodemailer from 'nodemailer'
import { serverEnv } from '@/lib/env'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
}

export type Mailer = { kind: 'resend' | 'smtp'; send: (email: OutgoingEmail) => Promise<void> }

/**
 * The app's own mailer for branded emails: Resend (RESEND_API_KEY) or SMTP (SMTP_HOST/USER/PASS,
 * e.g. the same SMTP server configured in Supabase Auth). Null when neither is configured.
 */
export function appMailer(): Mailer | null {
  const env = serverEnv()
  const from = env.EMAIL_FROM

  if (env.RESEND_API_KEY) {
    const key = env.RESEND_API_KEY
    return {
      kind: 'resend',
      send: async (email) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, ...email }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`Resend responded ${res.status}`)
      },
    }
  }

  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000,
    })
    return {
      kind: 'smtp',
      send: async (email) => {
        await transport.sendMail({ from, ...email })
      },
    }
  }
  return null
}
