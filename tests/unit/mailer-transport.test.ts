import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run, configFromEnv } from '../../scripts/mail-test'
import { server } from '../mocks/server'

const sendMail = vi.fn()
const { createTransport } = vi.hoisted(() => ({
  createTransport: vi.fn((_opts: Record<string, unknown>) => ({
    sendMail: (...a: unknown[]) => sendMail(...a),
  })),
}))
vi.mock('nodemailer', () => ({ default: { createTransport } }))

const {
  classifyMailFailure,
  createMailTransport,
  MailError,
  mailFailureMessage,
  mailerStatus,
  parseSender,
} = await import('@/lib/email/transport')

const email = {
  to: 'private.person@example.com',
  subject: 'S',
  html: '<p>secret body</p>',
  text: 'secret body',
}
const smtp = { port: 587, secure: false }
beforeEach(() => vi.clearAllMocks())

describe('mailerStatus (what the boot log and the modal rely on)', () => {
  it('Resend wins; SMTP needs host, user and password; names the missing variables, never values', () => {
    expect(mailerStatus({ from: 'a', resendApiKey: 're_x', smtp })).toEqual({
      configured: true,
      kind: 'resend',
    })
    expect(mailerStatus({ from: 'a', smtp: { ...smtp, host: 'h', user: 'u', pass: 'p' } })).toEqual(
      {
        configured: true,
        kind: 'smtp',
      },
    )
    expect(mailerStatus({ from: 'a', smtp: { ...smtp, host: 'h', user: 'u' } })).toEqual({
      configured: false,
      kind: 'none',
      missing: ['SMTP_PASS'],
    })
    expect(mailerStatus({ from: 'a', smtp })).toMatchObject({
      configured: false,
      missing: ['BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS'],
    })
    expect(createMailTransport({ from: 'a', smtp })).toBeNull()
  })
})

describe('Resend transport', () => {
  it('posts the message with the key and the configured sender', async () => {
    let seen: { auth: string | null; body: Record<string, string> } | undefined
    server.use(
      http.post('https://api.resend.com/emails', async ({ request }) => {
        seen = { auth: request.headers.get('authorization'), body: (await request.json()) as never }
        return HttpResponse.json({ id: 'e1' })
      }),
    )
    const transport = createMailTransport({
      from: 'TransVoice <no-reply@transvoice.ai>',
      resendApiKey: 're_key',
      smtp,
    })!
    await transport.send(email)
    expect(seen?.auth).toBe('Bearer re_key')
    expect(seen?.body).toMatchObject({
      from: 'TransVoice <no-reply@transvoice.ai>',
      to: email.to,
      subject: 'S',
    })
  })

  it('a refusal keeps the provider’s reason and nothing of the message', async () => {
    server.use(
      http.post('https://api.resend.com/emails', () =>
        HttpResponse.json(
          { message: 'The transvoice.ai domain is not verified.' },
          { status: 403 },
        ),
      ),
    )
    const transport = createMailTransport({ from: 'a', resendApiKey: 're_key', smtp })!
    const error = await transport.send(email).catch((e: Error) => e)
    expect((error as Error).message).toBe(
      'Resend responded 403: The transvoice.ai domain is not verified.',
    )
    expect((error as Error).message).not.toContain('private.person')
    expect((error as Error).message).not.toContain('secret body')
  })
})

describe('SMTP transport', () => {
  const config = { from: 'a', smtp: { ...smtp, host: 'smtp.example.com', user: 'u', pass: 'p' } }
  it('sends through nodemailer; errors carry the SMTP reply, not the message', async () => {
    sendMail.mockResolvedValueOnce({})
    await createMailTransport(config)!.send(email)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', to: email.to }))
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login: 535 Authentication failed'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    )
    const error = await createMailTransport(config)!
      .send(email)
      .catch((e: Error) => e)
    expect((error as Error).message).toBe(
      'SMTP EAUTH 535: Invalid login: 535 Authentication failed',
    )
  })
})

describe('pnpm mail:test', () => {
  const lines = () => {
    const out: string[] = []
    return { out, write: (l: string) => void out.push(l) }
  }

  it('needs an address', async () => {
    const { out, write } = lines()
    expect(await run(undefined, {}, write)).toBe(2)
    expect(await run('not-an-address', {}, write)).toBe(2)
    expect(out[0]).toContain('Usage: pnpm mail:test')
  })

  it('says exactly what to set when nothing is configured', async () => {
    const { out, write } = lines()
    expect(await run('me@example.com', { EMAIL_FROM: 'x' }, write)).toBe(1)
    expect(out.join('\n')).toContain(
      'Email is NOT configured. Set BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS',
    )
  })

  it('sends one message and reports success without printing the address or the key', async () => {
    server.use(http.post('https://api.resend.com/emails', () => HttpResponse.json({ id: 'ok' })))
    const { out, write } = lines()
    const code = await run('me.private@example.com', { RESEND_API_KEY: 're_secret_key' }, write)
    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('Transport: resend')
    expect(text).toContain('Sent.')
    expect(text).not.toContain('me.private@example.com')
    expect(text).not.toContain('re_secret_key')
  })

  it('reports the provider’s refusal', async () => {
    server.use(
      http.post('https://api.resend.com/emails', () =>
        HttpResponse.json({ message: 'API key is invalid' }, { status: 401 }),
      ),
    )
    const { out, write } = lines()
    expect(await run('me@example.com', { RESEND_API_KEY: 're_bad' }, write)).toBe(1)
    expect(out.join('\n')).toContain('FAILED: Resend responded 401: API key is invalid')
  })

  it('reads the same variables the server does, treating empty values as unset', () => {
    expect(
      configFromEnv({ SMTP_HOST: '', RESEND_API_KEY: '', SMTP_PORT: '465', SMTP_SECURE: 'true' }),
    ).toEqual({
      from: 'TransVoice AI <no-reply@transvoice.ai>',
      resendApiKey: undefined,
      smtp: { host: undefined, port: 465, secure: true, user: undefined, pass: undefined },
    })
  })
})

describe('Brevo', () => {
  const config = {
    from: 'TransVoice AI <no-reply@transvoice.ai>',
    brevoApiKey: 'xkeysib-secret',
    resendApiKey: 're_x',
    smtp,
  }

  it('BREVO_API_KEY wins over Resend and SMTP', () => {
    expect(mailerStatus(config)).toEqual({ configured: true, kind: 'brevo' })
  })

  it('posts to api.brevo.com/v3/smtp/email with the api-key header and a parsed sender', async () => {
    let seen: { key: string | null; body: Record<string, unknown> } | undefined
    server.use(
      http.post('https://api.brevo.com/v3/smtp/email', async ({ request }) => {
        seen = { key: request.headers.get('api-key'), body: (await request.json()) as never }
        return HttpResponse.json({ messageId: 'm1' }, { status: 201 })
      }),
    )
    await createMailTransport(config)!.send(email)
    expect(seen?.key).toBe('xkeysib-secret')
    expect(seen?.body).toMatchObject({
      sender: { name: 'TransVoice AI', email: 'no-reply@transvoice.ai' },
      to: [{ email: email.to }],
      subject: 'S',
      htmlContent: email.html,
      textContent: email.text,
    })
  })

  it.each([
    [401, { code: 'unauthorized', message: 'Key not found' }, 'auth'],
    [400, { code: 'invalid_parameter', message: 'Sender is not valid' }, 'sender'],
    [403, { code: 'permission_denied', message: 'Sender domain not verified' }, 'sender'],
    [429, { code: 'too_many_requests', message: 'Rate limit exceeded' }, 'quota'],
  ])(
    'maps a %i answer to a clear failure without the address or body',
    async (status, body, failure) => {
      server.use(
        http.post('https://api.brevo.com/v3/smtp/email', () => HttpResponse.json(body, { status })),
      )
      const error = await createMailTransport(config)!
        .send(email)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(MailError)
      expect((error as InstanceType<typeof MailError>).failure).toBe(failure)
      expect(String((error as Error).message)).not.toContain('private.person')
      expect(String((error as Error).message)).not.toContain('secret body')
      expect(String((error as Error).message)).not.toContain('xkeysib')
    },
  )
})

describe('SMTP (Brevo relay on 587)', () => {
  it('uses STARTTLS and refuses to continue without it on port 587; 465 uses implicit TLS', () => {
    createMailTransport({
      from: 'a',
      smtp: { host: 'smtp-relay.brevo.com', port: 587, secure: false, user: 'u', pass: 'p' },
    })
    expect(createTransport.mock.calls.at(-1)![0]).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
    })
    createMailTransport({
      from: 'a',
      smtp: { host: 'h', port: 465, secure: true, user: 'u', pass: 'p' },
    })
    expect(createTransport.mock.calls.at(-1)![0]).toMatchObject({ secure: true, requireTLS: false })
  })

  it('classifies SMTP answers', async () => {
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login: 535 Authentication failed'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    )
    const t = createMailTransport({
      from: 'a',
      smtp: { host: 'h', port: 587, secure: false, user: 'u', pass: 'p' },
    })!
    expect(((await t.send(email).catch((e) => e)) as InstanceType<typeof MailError>).failure).toBe(
      'auth',
    )
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Sender is not valid. Validate your sender'), { responseCode: 554 }),
    )
    expect(((await t.send(email).catch((e) => e)) as InstanceType<typeof MailError>).failure).toBe(
      'sender',
    )
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    )
    expect(((await t.send(email).catch((e) => e)) as InstanceType<typeof MailError>).failure).toBe(
      'network',
    )
  })
})

describe('helpers', () => {
  it('parses senders and words every failure', () => {
    expect(parseSender('TransVoice AI <no-reply@transvoice.ai>')).toEqual({
      name: 'TransVoice AI',
      email: 'no-reply@transvoice.ai',
    })
    expect(parseSender('no-reply@transvoice.ai')).toEqual({ email: 'no-reply@transvoice.ai' })
    expect(classifyMailFailure(500, 'boom')).toBe('rejected')
    for (const f of ['auth', 'sender', 'quota', 'network', 'rejected'] as const)
      expect(mailFailureMessage(f)).toMatch(/\.$/)
  })
})
