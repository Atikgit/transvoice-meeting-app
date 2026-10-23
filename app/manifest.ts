import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TransVoice Meet',
    short_name: 'TransVoice',
    description: 'Live voice-translated meetings.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0b0e16',
    theme_color: '#0b0e16',
    icons: [
      { src: '/brand/logo-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/logo-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
