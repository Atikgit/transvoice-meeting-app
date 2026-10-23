/**
 * Database types in the `supabase gen types typescript` format.
 *
 * Hand-maintained subset of supabase/migrations: only what the app reads or calls so far.
 * Once the project is linked, regenerate with `pnpm db:types` and delete this note.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type VoiceGender = 'male' | 'female'
export type OriginalAudioMode = 'off' | 'duck' | 'mute'
export type BillingType = 'free' | 'prepaid' | 'postpaid'
export type BillingStatus =
  'active' | 'on_trial' | 'past_due' | 'paused' | 'unpaid' | 'cancelled' | 'expired'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          headline: string | null
          linkedin_url: string | null
          spoken_lang: string
          listen_lang: string
          voice_gender: VoiceGender
          original_audio_mode: OriginalAudioMode
          created_at: string
          updated_at: string
          /** Server-only analytics columns: not selectable or editable by clients. */
          country_code: string | null
          country_name: string | null
          signup_ip_hash: string | null
          signup_at: string | null
        }
        Insert: never
        Update: {
          full_name?: string | null
          headline?: string | null
          linkedin_url?: string | null
          spoken_lang?: string
          listen_lang?: string
          voice_gender?: VoiceGender
          original_audio_mode?: OriginalAudioMode
        }
        Relationships: []
      }
      billing_accounts: {
        Row: {
          user_id: string
          billing_type: BillingType
          plan: string
          trial_minutes_remaining: number
          prepaid_minutes_remaining: number
          postpaid_minutes_accrued: number
          postpaid_credit_limit_minutes: number | null
          ls_customer_id: string | null
          ls_subscription_id: string | null
          ls_subscription_item_id: string | null
          ls_variant_id: number | null
          period_start: string | null
          period_end: string | null
          status: BillingStatus
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      ensure_user_account: {
        Args: { p_user: string }
        Returns: boolean
      }
      record_signup_geo: {
        Args: {
          p_user: string
          p_country_code: string | null
          p_country_name: string | null
          p_ip_hash: string | null
        }
        Returns: boolean
      }
      has_available_minutes: {
        Args: { p_user: string }
        Returns: boolean
      }
      debit_minutes: {
        Args: {
          p_payer: string
          p_minutes: number
          p_reason: string
          p_session?: string
          p_participant?: string
          p_bucket?: string
          p_multiplier?: number
        }
        Returns: number
      }
      credit_minutes: {
        Args: {
          p_user: string
          p_minutes: number
          p_event_id: string
          p_event_name: string
          p_variant_id: number
          p_plan: string
          p_payload?: Json
        }
        Returns: boolean
      }
      link_subscription: {
        Args: {
          p_user: string
          p_subscription_id: string
          p_customer_id: string
          p_variant_id: number
          p_status: string
          p_period_end: string | null
        }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type BillingAccount = Database['public']['Tables']['billing_accounts']['Row']
