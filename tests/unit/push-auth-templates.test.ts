import { readFileSync } from 'node:fs'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  allowList,
  changes,
  desiredConfig,
  formatChange,
  scrub,
  TEMPLATES,
} from '../../scripts/push-auth-templates'

const subjects = JSON.parse(readFileSync('supabase/templates/subjects.json', 'utf8'))
const contents = Object.fromEntries(
  Object.entries(TEMPLATES).map(([key, { file }]) => [
    key,
    readFileSync(`supabase/templates/${file}`, 'utf8'),
  ]),
) as Record<keyof typeof TEMPLATES, string>

describe('auth email templates', () => {
  it('exist for confirmation, recovery, email_change and invite with token-hash links', () => {
    expect(Object.keys(subjects).sort()).toEqual([
      'confirmation',
      'email_change',
      'invite',
      'recovery',
    ])
    const types = {
      confirmation: 'email',
      recovery: 'recovery',
      email_change: 'email_change',
      invite: 'invite',
    }
    for (const [key, type] of Object.entries(types)) {
      const html = contents[key as keyof typeof TEMPLATES]
      expect(html).toContain(`/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`)
      expect(html).toContain('https://meet.transvoice.ai/brand/logo-192.png')
      expect(html).not.toContain('{{ .ConfirmationURL }}')
    }
  })
})

describe('push-auth-templates', () => {
  it('uses the Management API field names', () => {
    const desired = desiredConfig({
      current: {},
      appUrl: 'https://meet.transvoice.ai/',
      subjects,
      contents,
      replaceAllowList: false,
    })
    expect(Object.keys(desired).sort()).toEqual([
      'mailer_subjects_confirmation',
      'mailer_subjects_email_change',
      'mailer_subjects_invite',
      'mailer_subjects_recovery',
      'mailer_templates_confirmation_content',
      'mailer_templates_email_change_content',
      'mailer_templates_invite_content',
      'mailer_templates_recovery_content',
      'site_url',
      'uri_allow_list',
    ])
    expect(desired.site_url).toBe('https://meet.transvoice.ai')
  })

  it('adds APP_URL/** to the allow-list, keeping other entries unless replaced', () => {
    const current = 'http://localhost:3000/**, https://meet.transvoice.ai/auth/callback'
    expect(allowList(current, 'https://meet.transvoice.ai', false)).toBe(
      'http://localhost:3000/**,https://meet.transvoice.ai/auth/callback,https://meet.transvoice.ai/**',
    )
    expect(allowList('https://meet.transvoice.ai/**', 'https://meet.transvoice.ai', false)).toBe(
      'https://meet.transvoice.ai/**',
    )
    expect(allowList(current, 'https://meet.transvoice.ai', true)).toBe(
      'https://meet.transvoice.ai/**',
    )
  })

  it('diffs only changed fields and summarises templates', () => {
    const diff = changes(
      { site_url: 'https://meet.transvoice.ai', mailer_templates_recovery_content: '<p>old</p>' },
      { site_url: 'https://meet.transvoice.ai', mailer_templates_recovery_content: '<p>new</p>' },
    )
    expect(diff.map((c) => c.field)).toEqual(['mailer_templates_recovery_content'])
    expect(formatChange(diff[0]!)).toMatch(/10 → 10 chars\n {4}first change at line 1: <p>new<\/p>/)
  })

  it('never prints the token', () => {
    expect(scrub('Unauthorized: sbp_secret123 is invalid', 'sbp_secret123')).toBe(
      'Unauthorized: [redacted] is invalid',
    )
  })

  it('PATCH body shape is accepted by the documented endpoint', async () => {
    // Shape check against a mocked endpoint (the real API is never called in tests).
    const { server } = await import('../mocks/server')
    let received: unknown
    server.use(
      http.patch('https://api.supabase.com/v1/projects/:ref/config/auth', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({})
      }),
    )
    await fetch('https://api.supabase.com/v1/projects/abc/config/auth', {
      method: 'PATCH',
      body: JSON.stringify({ site_url: 'https://meet.transvoice.ai' }),
    })
    expect(received).toEqual({ site_url: 'https://meet.transvoice.ai' })
  })
})
