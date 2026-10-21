import 'server-only'
import { serverEnv } from '@/lib/env'

export type OAuthProvider = 'google' | 'linkedin_oidc'

/** OAuth providers whose buttons are shown (each must also be enabled in Supabase). */
export function enabledProviders(): OAuthProvider[] {
  const env = serverEnv()
  const providers: OAuthProvider[] = []
  if (env.AUTH_GOOGLE_ENABLED) providers.push('google')
  if (env.AUTH_LINKEDIN_ENABLED) providers.push('linkedin_oidc')
  return providers
}
