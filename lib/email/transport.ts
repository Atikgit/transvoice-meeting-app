/**
 * The mail transports behind the app's branded emails (Brevo's or Resend's HTTPS API, or SMTP via nodemailer),
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
  /** Brevo transactional API key (HTTPS, port 443): wins over Resend and SMTP when set. */
  brevoApiKey?: string
  resendApiKey?: string
  smtp?: { host?: string; port: number; secure: boolean; user?: string; pass?: string }
}

export type MailTransport = {
  kind: 'brevo' | 'resend' | 'smtp'
  send: (email: OutgoingEmail) => Promise<void>
}

export type MailerStatus =
  | { configured: true; kind: 'brevo' | 'resend' | 'smtp' }
  | {
      configured: false
      kind: 'none'
      /** Names (never values) of the variables that would complete a started SMTP setup. */
      missing: string[]
    }

/** What is configured, for the boot log and the clear error in the modal. */
export function mailerStatus(config: MailConfig): MailerStatus {
  if (config.brevoApiKey) return { configured: true, kind: 'brevo' }
  if (config.resendApiKey) return { configured: true, kind: 'resend' }
  const smtp = config.smtp
  const missing = smtp
    ? [
        ...(smtp.host ? [] : ['SMTP_HOST']),
        ...(smtp.user ? [] : ['SMTP_USER']),
        ...(smtp.pass ? [] : ['SMTP_PASS']),
      ]
    : ['BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS']
  if (smtp && missing.length === 0) return { configured: true, kind: 'smtp' }
  // Only report a half-finished SMTP setup by name; with nothing set, say what to set.
  const started = Boolean(smtp?.host || smtp?.user || smtp?.pass)
  return {
    configured: false,
    kind: 'none',
    missing: started ? missing : ['BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS'],
  }
}

export type MailFailure = 'auth' | 'sender' | 'quota' | 'network' | 'rejected'

/** A send that failed, with what kind of failure it was (the message never has addresses or bodies). */
export class MailError extends Error {
  constructor(
    message: string,
    readonly failure: MailFailure,
  ) {
    super(message)
    this.name = 'MailError'
  }
}

const SENDER_HINT =
  /sender|from address|not (been )?(verified|validated|activated)|domain|unauthori[sz]ed sender/i
const QUOTA_HINT = /quota|limit|too many|credits|exceeded|throttl/i

/** Sorts a provider answer into the cases the person can act on. */
export function classifyMailFailure(
  status: number | string | undefined,
  text: string,
): MailFailure {
  if (
    status === 401 ||
    status === 'EAUTH' ||
    status === 535 ||
    /authentication|invalid (api )?key|api key/i.test(text)
  )
    return 'auth'
  if (
    typeof status === 'string' &&
    /^(ETIMEDOUT|ECONNECTION|ESOCKET|ECONNREFUSED|ENOTFOUND|EDNS)$/.test(status)
  )
    return 'network'
  if (status === 429 || status === 402 || status === 451 || status === 452 || QUOTA_HINT.test(text))
    return 'quota'
  if (SENDER_HINT.test(text) || status === 553 || status === 422) return 'sender'
  return 'rejected'
}

/** The sentence shown to the person who pressed Send Invite. */
export function mailFailureMessage(failure: MailFailure | undefined): string {
  switch (failure) {
    case 'auth':
      return 'Email sending is set up with wrong credentials. Please tell support; meanwhile share the link.'
    case 'sender':
      return 'The sender address is not verified with the email provider yet. Please tell support; meanwhile share the link.'
    case 'quota':
      return 'The email sending limit was reached. Try again later or share the link.'
    case 'network':
      return 'The email service could not be reached. Try again in a minute or share the link.'
    default:
      return 'The email could not be sent (the mail provider refused it). Share the link instead.'
  }
}

/** "Name <addr@host>" → { name, email }. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from)
  return match
    ? { name: match[1]!.trim() || undefined, email: match[2]!.trim() }
    : { email: from.trim() }
}

export function createMailTransport(config: MailConfig): MailTransport | null {
  const status = mailerStatus(config)
  if (!status.configured) return null

  if (status.kind === 'brevo') {
    const key = config.brevoApiKey!
    const sender = parseSender(config.from)
    return {
      kind: 'brevo',
      send: async (email) => {
        let res: Response
        try {
          res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key': key,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              sender,
              to: [{ email: email.to }],
              subject: email.subject,
              htmlContent: email.html,
              textContent: email.text,
            }),
            signal: AbortSignal.timeout(10_000),
          })
        } catch (error) {
          throw new MailError(
            `Brevo request failed: ${error instanceof Error ? error.message.slice(0, 100) : 'error'}`,
            'network',
          )
        }
        if (!res.ok) {
          // Brevo answers {code, message}: keep that sentence, never the request.
          const reason = (await res.json().catch(() => null)) as {
            code?: string
            message?: string
          } | null
          const text = `${reason?.code ?? ''} ${reason?.message ?? ''}`.slice(0, 160)
          throw new MailError(
            `Brevo responded ${res.status}: ${text.trim()}`,
            classifyMailFailure(res.status, text),
          )
        }
      },
    }
  }

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
          throw new MailError(
            `Resend responded ${res.status}${reason?.message ? `: ${String(reason.message).slice(0, 160)}` : ''}`,
            classifyMailFailure(res.status, String(reason?.message ?? '')),
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
    // Port 587 is STARTTLS: refuse to send (or log in) in the clear if the server does not offer it.
    requireTLS: !smtp.secure && smtp.port === 587,
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
        const text = String(e.message ?? '').slice(0, 160)
        throw new MailError(
          `SMTP ${e.code ?? 'error'}${e.responseCode ? ` ${e.responseCode}` : ''}: ${text}`,
          classifyMailFailure(e.code === 'EAUTH' ? 'EAUTH' : (e.responseCode ?? e.code), text),
        )
      }
    },
  }
}
