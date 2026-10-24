import { BRAND } from '@/lib/brand'
import { FREE_TRIAL_MINUTES } from '@/lib/billing/config'
import { LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface InviteEmail {
  /** The inviter's display name: user-controlled, always escaped. */
  inviterName: string
  /** https://meet.transvoice.ai/invite/<token>, built by the server. */
  inviteUrl: string
  /** "7 days" */
  expiresInLabel: string
}

export function inviteEmailSubject({ inviterName }: Pick<InviteEmail, 'inviterName'>): string {
  // Plain text header: strip control characters and keep it short.
  const name =
    inviterName
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 60) || 'Your partner'
  return `${name} invited you to a ${BRAND.name} meeting`
}

/** Plain-text alternative for clients that do not render HTML. */
export function buildInviteEmailText({
  inviterName,
  inviteUrl,
  expiresInLabel,
}: InviteEmail): string {
  return [
    `${inviterName} invited you to a meeting on ${BRAND.name}.`,
    `You speak and hear your own language across ${LANGUAGES_AND_VOICES}.`,
    '',
    `Accept invitation & join: ${inviteUrl}`,
    '',
    `New accounts start with ${FREE_TRIAL_MINUTES} free trial minutes. This invitation link is valid for ${expiresInLabel}.`,
  ].join('\n')
}

export function buildInviteEmailHtml({
  inviterName: rawName,
  inviteUrl: rawUrl,
  expiresInLabel: rawExpires,
}: InviteEmail): string {
  const inviterName = escapeHtml(rawName)
  const inviteUrl = escapeHtml(rawUrl)
  const expiresInLabel = escapeHtml(rawExpires)
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0b0f17;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f17;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
            <tr>
              <td style="padding:0 8px 24px;">
                <span style="font-size:16px;font-weight:700;letter-spacing:1.5px;color:#22d3ee;">${BRAND.wordmark.primary}</span>
                <span style="font-size:16px;font-weight:700;letter-spacing:1.5px;color:#facc15;"> ${BRAND.wordmark.accent}</span>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">${BRAND.tagline}</div>
              </td>
            </tr>
            <tr>
              <td style="background-color:#111827;border:1px solid #1e293b;border-radius:16px;padding:32px 28px;">
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">
                  ${inviterName} invited you to a meeting
                </h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#cbd5e1;">
                  Join <strong style="color:#ffffff;">${inviterName}</strong> on ${BRAND.name} for a live voice-translated call. You speak and hear your own language across ${escapeHtml(LANGUAGES_AND_VOICES)}.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                  <tr>
                    <td style="border-radius:10px;background-color:#22d3ee;">
                      <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#0f172a;text-decoration:none;">
                        Accept invitation &amp; join
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:12px;line-height:18px;color:#64748b;">
                  New accounts start with ${FREE_TRIAL_MINUTES} free trial minutes. This invitation link is valid for ${expiresInLabel}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;font-size:11px;line-height:16px;color:#475569;">
                ${BRAND.name} · Live voice-translated meetings in ${escapeHtml(LANGUAGES_AND_VOICES)}<br />
                You received this email because of an action on <a href="https://meet.transvoice.ai" style="color:#22d3ee;text-decoration:none;">meet.transvoice.ai</a>.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
