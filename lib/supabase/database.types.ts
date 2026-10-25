/**
 * App-facing database types. `database.generated.ts` is written by `pnpm db:types`
 * (`supabase gen types`); this file adds the aliases and helpers the generator cannot express.
 */
import type { Database } from './database.generated'

export type { Database, Json } from './database.generated'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type BillingAccount = Database['public']['Tables']['billing_accounts']['Row']

export type OriginalAudioMode = 'off' | 'duck' | 'mute'
export type AnswerOutcome = 'accepted' | 'declined'

/**
 * Generated RPC argument types forbid `null` for parameters the SQL function accepts as null
 * (a `default` makes them optional instead). Passes the value through, typed as non-null.
 */
export const nullableArg = <T>(value: T | null): T => value as T
