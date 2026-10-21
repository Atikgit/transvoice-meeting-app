export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SKIP_ENV_VALIDATION) return
  const { serverEnv } = await import('@/lib/env')
  serverEnv()
}
