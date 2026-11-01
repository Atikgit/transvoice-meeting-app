/** The only place brand strings live. UI, metadata and the manifest read them from here. */
export const BRAND = {
  /** Product name in sentences, titles and alt text. */
  name: 'TransVoice AI',
  /** Installed web app name (manifest). */
  appName: 'TransVoice AI Meet',
  /** Header wordmark: primary part in cyan, accent in gold. */
  wordmark: { primary: 'TRANSVOICE', accent: 'AI' },
  tagline: 'Meet without limits',
  description: 'Live voice-translated meetings',
  /** Search and social-sharing metadata (title, Open Graph, Twitter card). */
  seo: {
    title: 'TransVoice Meet — Real-Time Translated Video Meetings',
    description:
      'Host secure, P2P encrypted video calls with built-in, ultra-low latency voice translation and live subtitles in 140+ languages.',
    applicationName: 'TransVoice Meeting App',
    siteName: 'TransVoice AI',
    url: 'https://meet.transvoice.ai',
    image: {
      url: 'https://transvoice.ai/assets/meeting-app.jpg',
      width: 1200,
      height: 630,
      alt: 'TransVoice Live Translated Meeting App Dashboard',
    },
  },
} as const

/** Next.js title template for every page: "Sign in · TransVoice AI". */
export const TITLE_TEMPLATE = `%s · ${BRAND.name}`
