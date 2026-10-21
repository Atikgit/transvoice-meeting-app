/** Fake environment for unit tests. Never real credentials. */
export const TEST_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  NEXT_PUBLIC_LIVEKIT_URL: 'wss://test.livekit.cloud',
  LIVEKIT_API_KEY: 'test-livekit-key',
  LIVEKIT_API_SECRET: 'test-livekit-secret',
  TRANSVOICE_API_URL: 'https://transvoice.test',
  TRANSVOICE_MASTER_API_KEY: 'tv_test_master_key',
  LEMONSQUEEZY_WEBHOOK_SECRET: 'test-ls-webhook-secret',
} as const
