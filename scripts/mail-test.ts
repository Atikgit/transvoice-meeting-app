/**
 * Sends one test message through the same transport the app uses (Resend or SMTP), so email can be
 * checked without the app:
 *
 *   pnpm mail:test you@example.com
 *
 * Reads RESEND_API_KEY / SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS / EMAIL_FROM from
 * the environment, and from `.env.production` when that file exists. Prints which transport was
 * used and the provider's answer; never the address, the keys or the message.
 */
import { pathToFileURL } from 'node:url'
import { createMailTransport, mailerStatus, type MailConfig } from '../lib/email/transport.ts'

export function configFromEnv(env: Record<string, string | undefined>): MailConfig {
  const present = (name: string) => (env[name] && env[name] !== '' ? env[name] : undefined)
  return {
    from: present('EMAIL_FROM') ?? 'TransVoice AI <no-reply@transvoice.ai>',
    resendApiKey: present('RESEND_API_KEY'),
    smtp: {
      host: present('SMTP_HOST'),
      port: Number(present('SMTP_PORT') ?? 587),
      secure: present('SMTP_SECURE') === 'true',
      user: present('SMTP_USER'),
      pass: present('SMTP_PASS'),
    },
  }
}

export async function run(
  to: string | undefined,
  env: Record<string, string | undefined> = process.env,
  out: (line: string) => void = console.log,
): Promise<number> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    out('Usage: pnpm mail:test <address-to-send-the-test-to>')
    return 2
  }
  const config = configFromEnv(env)
  const status = mailerStatus(config)
  if (!status.configured) {
    out(
      `Email is NOT configured. Set ${status.missing.join(', ')} (and EMAIL_FROM) in .env.production.`,
    )
    return 1
  }
  out(`Transport: ${status.kind}, from: ${config.from}`)
  const transport = createMailTransport(config)!
  try {
    await transport.send({
      to,
      subject: 'TransVoice AI mail test',
      text: 'This is a test message from `pnpm mail:test`. If you can read it, invite emails can be sent.',
      html: '<p>This is a test message from <code>pnpm mail:test</code>. If you can read it, invite emails can be sent.</p>',
    })
    out('Sent. Check the inbox (and the spam folder) of the address you passed.')
    return 0
  } catch (error) {
    out(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv[2])
}
