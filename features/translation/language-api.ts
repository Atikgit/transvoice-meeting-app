/** POST /api/calls/[id]/languages: returns the values the server stored (or an error message). */
export async function saveLanguages(
  sessionId: string,
  patch: { spokenLang?: string; listenLang?: string },
): Promise<{ ok: true; spokenLang: string; listenLang: string } | { ok: false; error: string }> {
  const res = await fetch(`/api/calls/${sessionId}/languages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => null)
  if (res?.ok) {
    const body = (await res.json()) as { spokenLang: string; listenLang: string }
    return { ok: true, spokenLang: body.spokenLang, listenLang: body.listenLang }
  }
  const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined
  return { ok: false, error: body?.error ?? 'Could not change the language.' }
}
