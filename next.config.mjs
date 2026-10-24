/**
 * Content-Security-Policy. NEXT_PUBLIC_* URLs are build args (Docker) so they are known here.
 * - script-src 'wasm-unsafe-eval': ONNX Runtime (voice activity detection) compiles WASM.
 * - 'unsafe-inline' scripts: Next.js inline bootstrap without nonces; 'unsafe-eval' only in dev.
 * - connect-src: LiveKit (wss + https), Supabase (REST + Realtime wss).
 * - media-src / worker-src blob:: translated audio clips and the VAD AudioWorklet.
 * - form-action: OAuth sign-in redirects through Supabase to Google / LinkedIn.
 */
function originsOf(url) {
  if (!url) return []
  try {
    const u = new URL(url)
    const https = `https://${u.host}`
    const wss = `wss://${u.host}`
    return [https, wss]
  } catch {
    return []
  }
}

function contentSecurityPolicy() {
  const dev = process.env.NODE_ENV !== 'production'
  const livekit = originsOf(process.env.NEXT_PUBLIC_LIVEKIT_URL)
  const supabase = originsOf(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      ...livekit,
      ...supabase,
      ...(dev ? ['ws:', 'http://127.0.0.1:*'] : []),
    ],
    'media-src': ["'self'", 'blob:', 'mediastream:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': [
      "'self'",
      ...supabase.filter((o) => o.startsWith('https')),
      'https://accounts.google.com',
      'https://www.linkedin.com',
    ],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image; ignored by Vercel previews.
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(self), microphone=(self), display-capture=(self), screen-wake-lock=(self)',
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // Pinned per release (public/vad/VERSIONS.json); the WASM is large, let browsers keep it.
        source: '/vad/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ]
  },
}

export default nextConfig
