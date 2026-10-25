export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      api_usage_events: {
        Row: {
          created_at: string
          id: number
          request_id: string
          session_id: string | null
          speaker_id: string | null
          speech_seconds: number
          target_lang: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          request_id: string
          session_id?: string | null
          speaker_id?: string | null
          speech_seconds: number
          target_lang?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          request_id?: string
          session_id?: string | null
          speaker_id?: string | null
          speech_seconds?: number
          target_lang?: string | null
        }
        Relationships: []
      }
      billing_accounts: {
        Row: {
          billing_type: string
          created_at: string
          ls_customer_id: string | null
          ls_subscription_id: string | null
          ls_subscription_item_id: string | null
          ls_variant_id: number | null
          period_end: string | null
          period_start: string | null
          plan: string
          postpaid_credit_limit_minutes: number | null
          postpaid_minutes_accrued: number
          prepaid_minutes_remaining: number
          status: string
          trial_minutes_remaining: number
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_type?: string
          created_at?: string
          ls_customer_id?: string | null
          ls_subscription_id?: string | null
          ls_subscription_item_id?: string | null
          ls_variant_id?: number | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          postpaid_credit_limit_minutes?: number | null
          postpaid_minutes_accrued?: number
          prepaid_minutes_remaining?: number
          status?: string
          trial_minutes_remaining?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_type?: string
          created_at?: string
          ls_customer_id?: string | null
          ls_subscription_id?: string | null
          ls_subscription_item_id?: string | null
          ls_variant_id?: number | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          postpaid_credit_limit_minutes?: number | null
          postpaid_minutes_accrued?: number
          prepaid_minutes_remaining?: number
          status?: string
          trial_minutes_remaining?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_accounts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      call_sessions: {
        Row: {
          callee_id: string | null
          created_at: string
          end_reason: string | null
          ended_at: string | null
          host_id: string
          id: string
          initiated_by: string
          meeting_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          callee_id?: string | null
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          host_id: string
          id?: string
          initiated_by: string
          meeting_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          callee_id?: string | null
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          host_id?: string
          id?: string
          initiated_by?: string
          meeting_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'call_sessions_callee_id_fkey'
            columns: ['callee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_sessions_host_id_fkey'
            columns: ['host_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_sessions_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_sessions_meeting_id_fkey'
            columns: ['meeting_id']
            isOneToOne: false
            referencedRelation: 'meetings'
            referencedColumns: ['id']
          },
        ]
      }
      chat_messages: {
        Row: {
          attachment_path: string | null
          body: string
          created_at: string
          id: string
          meeting_id: string | null
          recipient_id: string | null
          sender_id: string
        }
        Insert: {
          attachment_path?: string | null
          body: string
          created_at?: string
          id?: string
          meeting_id?: string | null
          recipient_id?: string | null
          sender_id: string
        }
        Update: {
          attachment_path?: string | null
          body?: string
          created_at?: string
          id?: string
          meeting_id?: string | null
          recipient_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_messages_meeting_id_fkey'
            columns: ['meeting_id']
            isOneToOne: false
            referencedRelation: 'meetings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_messages_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      connections: {
        Row: {
          contact_id: string
          created_at: string
          source: string
          user_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          source?: string
          user_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'connections_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'connections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          id: string
          inviter_id: string
          max_uses: number
          meeting_id: string
          revoked_at: string | null
          sponsor_window: string
          token_hash: string
          used_count: number
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          inviter_id: string
          max_uses?: number
          meeting_id: string
          revoked_at?: string | null
          sponsor_window?: string
          token_hash: string
          used_count?: number
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          inviter_id?: string
          max_uses?: number
          meeting_id?: string
          revoked_at?: string | null
          sponsor_window?: string
          token_hash?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'invitations_inviter_id_fkey'
            columns: ['inviter_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitations_meeting_id_fkey'
            columns: ['meeting_id']
            isOneToOne: false
            referencedRelation: 'meetings'
            referencedColumns: ['id']
          },
        ]
      }
      meeting_participants: {
        Row: {
          joined_at: string
          listen_lang: string
          payer_id: string
          role: string
          session_id: string
          spoken_lang: string
          sponsored_connection_id: string | null
          user_id: string
        }
        Insert: {
          joined_at?: string
          listen_lang: string
          payer_id: string
          role: string
          session_id: string
          spoken_lang: string
          sponsored_connection_id?: string | null
          user_id: string
        }
        Update: {
          joined_at?: string
          listen_lang?: string
          payer_id?: string
          role?: string
          session_id?: string
          spoken_lang?: string
          sponsored_connection_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meeting_participants_payer_id_fkey'
            columns: ['payer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meeting_participants_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'call_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meeting_participants_sponsored_connection_id_fkey'
            columns: ['sponsored_connection_id']
            isOneToOne: false
            referencedRelation: 'sponsored_connections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meeting_participants_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      meetings: {
        Row: {
          created_at: string
          id: string
          locked: boolean
          max_participants: number
          owner_id: string
          room_name: string
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          locked?: boolean
          max_participants?: number
          owner_id: string
          room_name: string
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          locked?: boolean
          max_participants?: number
          owner_id?: string
          room_name?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'meetings_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      participant_segments: {
        Row: {
          connected_at: string
          disconnected_at: string | null
          id: number
          last_heartbeat_at: string | null
          payer_id: string
          session_id: string
          user_id: string
        }
        Insert: {
          connected_at: string
          disconnected_at?: string | null
          id?: never
          last_heartbeat_at?: string | null
          payer_id: string
          session_id: string
          user_id: string
        }
        Update: {
          connected_at?: string
          disconnected_at?: string | null
          id?: never
          last_heartbeat_at?: string | null
          payer_id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'participant_segments_payer_id_fkey'
            columns: ['payer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'participant_segments_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'call_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'participant_segments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          minutes: number | null
          payload: Json
          user_id: string | null
          variant_id: number | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id: string
          minutes?: number | null
          payload: Json
          user_id?: string | null
          variant_id?: number | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          minutes?: number | null
          payload?: Json
          user_id?: string | null
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'payment_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country_code: string | null
          country_name: string | null
          created_at: string
          full_name: string | null
          headline: string | null
          id: string
          linkedin_url: string | null
          listen_lang: string
          original_audio_mode: string
          signup_at: string | null
          signup_ip_hash: string | null
          spoken_lang: string
          updated_at: string
          voice_gender: string
        }
        Insert: {
          avatar_url?: string | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          full_name?: string | null
          headline?: string | null
          id: string
          linkedin_url?: string | null
          listen_lang?: string
          original_audio_mode?: string
          signup_at?: string | null
          signup_ip_hash?: string | null
          spoken_lang?: string
          updated_at?: string
          voice_gender?: string
        }
        Update: {
          avatar_url?: string | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          full_name?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          listen_lang?: string
          original_audio_mode?: string
          signup_at?: string | null
          signup_ip_hash?: string | null
          spoken_lang?: string
          updated_at?: string
          voice_gender?: string
        }
        Relationships: []
      }
      sponsored_connections: {
        Row: {
          created_at: string
          expires_at: string
          guest_id: string
          id: string
          invitation_id: string | null
          meeting_id: string
          revoked_at: string | null
          sponsor_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          guest_id: string
          id?: string
          invitation_id?: string | null
          meeting_id: string
          revoked_at?: string | null
          sponsor_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          guest_id?: string
          id?: string
          invitation_id?: string | null
          meeting_id?: string
          revoked_at?: string | null
          sponsor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sponsored_connections_guest_id_fkey'
            columns: ['guest_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sponsored_connections_invitation_id_fkey'
            columns: ['invitation_id']
            isOneToOne: false
            referencedRelation: 'invitations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sponsored_connections_meeting_id_fkey'
            columns: ['meeting_id']
            isOneToOne: false
            referencedRelation: 'meetings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sponsored_connections_sponsor_id_fkey'
            columns: ['sponsor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      transcripts: {
        Row: {
          created_at: string
          id: number
          original_text: string
          session_id: string
          speaker_id: string
          src_lang: string | null
          translations: Json
        }
        Insert: {
          created_at?: string
          id?: never
          original_text: string
          session_id: string
          speaker_id: string
          src_lang?: string | null
          translations?: Json
        }
        Update: {
          created_at?: string
          id?: never
          original_text?: string
          session_id?: string
          speaker_id?: string
          src_lang?: string | null
          translations?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'transcripts_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'call_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transcripts_speaker_id_fkey'
            columns: ['speaker_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      usage_ledger: {
        Row: {
          billed_minutes: number
          billing_type: string
          created_at: string
          id: number
          kind: string
          lang_multiplier: number | null
          minute_bucket: string | null
          participant_id: string | null
          payer_id: string
          prepaid_minutes: number
          reason: string | null
          session_id: string | null
          synced_to_ls_at: string | null
          trial_minutes: number
        }
        Insert: {
          billed_minutes: number
          billing_type: string
          created_at?: string
          id?: never
          kind: string
          lang_multiplier?: number | null
          minute_bucket?: string | null
          participant_id?: string | null
          payer_id: string
          prepaid_minutes?: number
          reason?: string | null
          session_id?: string | null
          synced_to_ls_at?: string | null
          trial_minutes?: number
        }
        Update: {
          billed_minutes?: number
          billing_type?: string
          created_at?: string
          id?: never
          kind?: string
          lang_multiplier?: number | null
          minute_bucket?: string | null
          participant_id?: string | null
          payer_id?: string
          prepaid_minutes?: number
          reason?: string | null
          session_id?: string | null
          synced_to_ls_at?: string | null
          trial_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: 'usage_ledger_payer_id_fkey'
            columns: ['payer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'usage_ledger_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'call_sessions'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_token_hash: string; p_user: string }
        Returns: string
      }
      admit_participant: {
        Args: { p_session: string; p_user: string }
        Returns: {
          display_name: string
          listen_lang: string
          meeting_id: string
          payer_id: string
          role: string
          spoken_lang: string
          status: string
        }[]
      }
      answer_call: {
        Args: { p_accept: boolean; p_session: string; p_user: string }
        Returns: {
          meeting_id: string
          outcome: string
        }[]
      }
      call_rights: {
        Args: { p_meeting: string; p_user: string }
        Returns: string
      }
      cancel_call: {
        Args: { p_session: string; p_user: string }
        Returns: string
      }
      create_call: {
        Args: { p_caller: string; p_meeting: string }
        Returns: {
          callee_id: string
          expires_at: string
          meeting_id: string
          mode: string
          session_id: string
        }[]
      }
      create_invitation: {
        Args: {
          p_max_uses?: number
          p_meeting?: string
          p_token_hash: string
          p_user: string
          p_window?: string
        }
        Returns: {
          expires_at: string
          invitation_id: string
          meeting_id: string
          reused: boolean
        }[]
      }
      create_meeting: {
        Args: { p_title?: string; p_user: string }
        Returns: string
      }
      credit_minutes: {
        Args: {
          p_event_id: string
          p_event_name: string
          p_minutes: number
          p_payload?: Json
          p_plan: string
          p_user: string
          p_variant_id: number
        }
        Returns: boolean
      }
      debit_minutes: {
        Args: {
          p_bucket?: string
          p_minutes: number
          p_multiplier?: number
          p_participant?: string
          p_payer: string
          p_reason: string
          p_session?: string
        }
        Returns: number
      }
      end_call_session: {
        Args: { p_reason?: string; p_session: string; p_user: string }
        Returns: boolean
      }
      ensure_user_account: { Args: { p_user: string }; Returns: boolean }
      expire_ringing: { Args: never; Returns: number }
      has_available_minutes: { Args: { p_user: string }; Returns: boolean }
      incoming_calls: {
        Args: { p_user: string }
        Returns: {
          caller_id: string
          caller_name: string
          expires_at: string
          from_host: boolean
          meeting_id: string
          session_id: string
        }[]
      }
      link_subscription: {
        Args: {
          p_customer_id: string
          p_period_end: string
          p_status: string
          p_subscription_id: string
          p_user: string
          p_variant_id: number
        }
        Returns: undefined
      }
      open_call_session: {
        Args: { p_meeting: string; p_user: string }
        Returns: {
          created: boolean
          host_id: string
          session_id: string
          started_at: string
          status: string
        }[]
      }
      record_livekit_event: {
        Args: {
          p_at: string
          p_event: string
          p_event_id: string
          p_session: string
          p_user: string
        }
        Returns: string
      }
      record_signup_geo: {
        Args: {
          p_country_code: string
          p_country_name: string
          p_ip_hash: string
          p_user: string
        }
        Returns: boolean
      }
      resolve_payer: {
        Args: { p_meeting: string; p_user: string }
        Returns: string
      }
      revoke_invitation: {
        Args: { p_token_hash: string; p_user: string }
        Returns: boolean
      }
      set_participant_langs: {
        Args: {
          p_listen?: string
          p_session: string
          p_spoken?: string
          p_user: string
        }
        Returns: {
          display_name: string
          listen_lang: string
          role: string
          spoken_lang: string
        }[]
      }
      stale_open_sessions: {
        Args: { p_older_than: string }
        Returns: {
          host_id: string
          idle_since: string
          session_id: string
          status: string
        }[]
      }
      start_call_session: {
        Args: { p_session: string; p_user: string }
        Returns: {
          session_id: string
          started_at: string
        }[]
      }
      sweep_orphans: {
        Args: never
        Returns: {
          ringing_expired: number
          segments_closed: number
        }[]
      }
      translation_context: {
        Args: { p_session: string; p_speaker: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
