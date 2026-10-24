/**
 * Pushes the branded auth email templates (supabase/templates) and the URL settings to Supabase
 * through the Management API: PATCH /v1/projects/{ref}/config/auth.
 *
 *   SUPABASE_ACCESS_TOKEN=… APP_URL=https://meet.transvoice.ai pnpm auth:templates [--dry-run]
 *
 * Options:
 *   --dry-run              print the diff, change nothing
 *   --replace-allow-list   set the redirect allow-list to exactly APP_URL/** (default: add it,
 *                          keeping existing entries such as localhost and preview URLs)
 *   --project-ref <ref>    default: SUPABASE_PROJECT_REF, else supabase/.temp/project-ref
 *
 * The access token (Supabase → Account → Access Tokens) is only sent as a header, never logged.
 * Field names verified against https://api.supabase.com/api/v1-json (UpdateAuthConfigBody).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const API = 'https://api.supabase.com/v1'
const TEMPLATES_DIR = join(process.cwd(), 'supabase', 'templates')

/** Template file → Management API field names. */
export const TEMPLATES = {
  confirmation: {
    file: 'confirm.html',
    subject: 'mailer_subjects_confirmation',
    content: 'mailer_templates_confirmation_content',
  },
  recovery: {
    file: 'recovery.html',
    subject: 'mailer_subjects_recovery',
    content: 'mailer_templates_recovery_content',
  },
  email_change: {
    file: 'email_change.html',
    subject: 'mailer_subjects_email_change',
    content: 'mailer_templates_email_change_content',
  },
  invite: {
    file: 'invite.html',
    subject: 'mailer_subjects_invite',
    content: 'mailer_templates_invite_content',
  },
} as const

export type AuthConfig = Record<string, unknown>

/** Redirect allow-list (comma-separated in the API) with APP_URL/** added or set exclusively. */
export function allowList(current: unknown, appUrl: string, replace: boolean): string {
  const required = `${new URL(appUrl).origin}/**`
  if (replace) return required
  const entries = String(current ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.includes(required) ? entries.join(',') : [...entries, required].join(',')
}

export function desiredConfig(input: {
  current: AuthConfig
  appUrl: string
  subjects: Record<keyof typeof TEMPLATES, string>
  contents: Record<keyof typeof TEMPLATES, string>
  replaceAllowList: boolean
}): AuthConfig {
  const config: AuthConfig = {
    site_url: new URL(input.appUrl).origin,
    uri_allow_list: allowList(input.current.uri_allow_list, input.appUrl, input.replaceAllowList),
  }
  for (const [key, fields] of Object.entries(TEMPLATES) as [
    keyof typeof TEMPLATES,
    (typeof TEMPLATES)[keyof typeof TEMPLATES],
  ][]) {
    config[fields.subject] = input.subjects[key]
    config[fields.content] = input.contents[key]
  }
  return config
}

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/** Fields of `desired` that differ from `current`. */
export function changes(current: AuthConfig, desired: AuthConfig): FieldChange[] {
  return Object.entries(desired)
    .filter(([field, after]) => current[field] !== after)
    .map(([field, after]) => ({ field, before: current[field], after }))
}

/** Human-readable diff: short values in full, templates by size and first differing line. */
export function formatChange({ field, before, after }: FieldChange): string {
  const text = (value: unknown) =>
    value === null || value === undefined ? '(unset)' : String(value)
  if (!field.endsWith('_content')) return `  ${field}: ${text(before)} → ${text(after)}`
  const oldLines = text(before).split('\n')
  const newLines = String(after).split('\n')
  const first = newLines.findIndex((line, i) => line !== oldLines[i])
  return [
    `  ${field}: ${text(before).length} → ${String(after).length} chars`,
    first >= 0
      ? `    first change at line ${first + 1}: ${newLines[first]!.trim().slice(0, 100)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Never let the token reach logs, even inside an error body. */
export function scrub(message: string, token: string): string {
  return token ? message.split(token).join('[redacted]') : message
}

async function request(
  method: 'GET' | 'PATCH',
  ref: string,
  token: string,
  body?: AuthConfig,
): Promise<AuthConfig> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(ref)}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = scrub((await res.text()).slice(0, 500), token)
    throw new Error(`${method} config/auth failed: HTTP ${res.status} ${detail}`)
  }
  return (await res.json()) as AuthConfig
}

async function projectRef(args: string[]): Promise<string> {
  const flag = args.indexOf('--project-ref')
  if (flag >= 0 && args[flag + 1]) return args[flag + 1]!
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF
  try {
    return (await readFile(join(process.cwd(), 'supabase', '.temp', 'project-ref'), 'utf8')).trim()
  } catch {
    throw new Error('Set SUPABASE_PROJECT_REF, pass --project-ref, or run `supabase link` first.')
  }
}

async function main(args: string[]) {
  const dryRun = args.includes('--dry-run')
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  const appUrl = process.env.APP_URL ?? ''
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set.')
  if (!appUrl) throw new Error('APP_URL is not set (e.g. https://meet.transvoice.ai).')
  const ref = await projectRef(args)

  const subjects = JSON.parse(
    await readFile(join(TEMPLATES_DIR, 'subjects.json'), 'utf8'),
  ) as Record<keyof typeof TEMPLATES, string>
  const contents = Object.fromEntries(
    await Promise.all(
      Object.entries(TEMPLATES).map(async ([key, { file }]) => [
        key,
        await readFile(join(TEMPLATES_DIR, file), 'utf8'),
      ]),
    ),
  ) as Record<keyof typeof TEMPLATES, string>
  for (const key of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
    if (!subjects[key]) throw new Error(`subjects.json has no subject for "${key}".`)
  }

  try {
    const current = await request('GET', ref, token)
    const desired = desiredConfig({
      current,
      appUrl,
      subjects,
      contents,
      replaceAllowList: args.includes('--replace-allow-list'),
    })
    const diff = changes(current, desired)
    console.log(`Project ${ref}: ${diff.length} of ${Object.keys(desired).length} fields differ.`)
    for (const change of diff) console.log(formatChange(change))
    if (diff.length === 0 || dryRun) {
      if (dryRun) console.log('Dry run: nothing changed.')
      return
    }
    await request('PATCH', ref, token, Object.fromEntries(diff.map((c) => [c.field, c.after])))
    console.log('Auth config updated.')
  } catch (error) {
    throw new Error(scrub(error instanceof Error ? error.message : String(error), token))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
