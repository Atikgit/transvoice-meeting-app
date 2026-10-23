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
} as const

/** Next.js title template for every page: "Sign in · TransVoice AI". */
export const TITLE_TEMPLATE = `%s · ${BRAND.name}`
