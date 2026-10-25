export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SKIP_ENV_VALIDATION) return
  const { serverEnv } = await import('@/lib/env')
  const env = serverEnv()

  // Background work and shutdown only in the real server, not during `next build` or in dev
  // hot reloads of tests.
  if (process.env.NODE_ENV !== 'production') return
  const { startSweeper, stopSweeper } = await import('@/lib/sweeper')
  const { DRAIN_MAX_MS, startDraining } = await import('@/lib/draining')
  if (env.SWEEP_INTERVAL_SEC > 0) startSweeper()
  // Is email set up? Names of missing variables only; never addresses or keys.
  const { appMailerStatus } = await import('@/lib/email/mailer')
  const mail = appMailerStatus()
  console.info(
    JSON.stringify({
      event: 'mailer',
      configured: mail.configured,
      kind: mail.kind,
      ...(mail.configured ? {} : { missing: mail.missing }),
    }),
  )
  // Boot ping (logs whether the API is reachable) and keep-alive while sessions are live.
  const { startWarmup, stopWarmup } = await import('@/lib/transvoice/warmup')
  startWarmup(env.TRANSVOICE_WARMUP_SEC * 1000)

  // Next.js already stops accepting connections and finishes in-flight requests on SIGTERM
  // (docker stop). This listener runs alongside it for what Next does not know about.
  let shuttingDown = false
  process.once('SIGTERM', () => {
    if (shuttingDown) return
    shuttingDown = true
    // Draining: /api/translate answers 503 {retryable} from now on, requests in flight finish
    // (Next closes the server and waits for them), and after DRAIN_MAX_MS we leave anyway.
    startDraining()
    setTimeout(() => process.exit(143), DRAIN_MAX_MS)
    void (async () => {
      const [{ clearGraceChecks }, { closeAudioCache }] = await Promise.all([
        import('@/lib/livekit/grace'),
        import('@/lib/translation/audio-cache'),
      ])
      console.log(JSON.stringify({ event: 'shutdown', signal: 'SIGTERM' }))
      stopWarmup()
      await (await import('@/lib/transvoice/http')).closeTransvoicePool()
      clearGraceChecks() // lost timers are recovered by the sweeper of the next container
      await stopSweeper()
      await closeAudioCache()
    })().catch(() => {})
  })
}
