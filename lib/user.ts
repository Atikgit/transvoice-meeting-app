import type { User } from '@supabase/supabase-js'

/** The user's full name from signup metadata, or undefined. */
export function getDisplayName(user: User | null): string | undefined {
  const fullName: unknown = user?.user_metadata?.full_name
  return typeof fullName === 'string' && fullName ? fullName : undefined
}
