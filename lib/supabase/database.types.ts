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
export type CallStatus = 'ringing' | 'live' | 'ended' | 'missed' | 'declined'
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
      meetings: {
        Row: {
          id: string
          owner_id: string
          title: string | null
          room_name: string
          max_participants: number
          locked: boolean
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      invitations: {
        /** token_hash is not selectable by clients. */
        Row: {
          id: string
          meeting_id: string
          inviter_id: string
          token_hash: string
          email: string | null
          max_uses: number
          used_count: number
          sponsor_window: string
          expires_at: string
          revoked_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      sponsored_connections: {
        Row: {
          id: string
          sponsor_id: string
          guest_id: string
          meeting_id: string
          invitation_id: string | null
          expires_at: string
          revoked_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      call_sessions: {
        Row: {
          id: string
          meeting_id: string
          host_id: string
          initiated_by: string
          status: CallStatus
          started_at: string | null
          ended_at: string | null
          end_reason: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      start_call_session: {
        Args: { p_meeting: string; p_user: string }
        Returns: { session_id: string; started_at: string }[]
      }
      join_call_session: {
        Args: { p_session: string; p_user: string }
        Returns: string
      }
      end_call_session: {
        Args: { p_session: string; p_user: string }
        Returns: undefined
      }
      create_meeting: {
        Args: { p_user: string; p_title?: string }
        Returns: string
      }
      create_invitation: {
        Args: { p_user: string; p_token_hash: string; p_window?: string; p_meeting?: string }
        Returns: { meeting_id: string; invitation_id: string; expires_at: string }[]
      }
      accept_invitation: {
        Args: { p_token_hash: string; p_user: string }
        Returns: string
      }
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
