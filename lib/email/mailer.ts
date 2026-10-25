import 'server-only'
import { serverEnv } from '@/lib/env'
import {
  createMailTransport,
  mailerStatus,
  type MailConfig,
  type MailerStatus,
  type MailTransport,
  type OutgoingEmail,
} from '@/lib/email/transport'

export type { OutgoingEmail }
export type Mailer = MailTransport

function mailConfig(): MailConfig {
  const env = serverEnv()
  return {
    from: env.EMAIL_FROM,
    resendApiKey: env.RESEND_API_KEY,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  }
}

/**
 * The app's own mailer for branded emails: Resend (RESEND_API_KEY) or SMTP (SMTP_HOST, SMTP_USER,
 * SMTP_PASS [+ SMTP_PORT, SMTP_SECURE]); EMAIL_FROM must be an address the provider accepts.
 * Null when neither is configured.
 */
export function appMailer(): Mailer | null {
  return createMailTransport(mailConfig())
}

/** What is configured (names only), for the boot log and for the "not configured" message. */
export function appMailerStatus(): MailerStatus {
  return mailerStatus(mailConfig())
}
