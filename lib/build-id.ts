/** The build this code was compiled in (next.config.mjs inlines it into server and browser bundles). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'

/**
 * Version of the translation data-message format. Raise it when a change would make an older tab
 * misread a message; the tab then shows "New version available" and keeps to captions.
 */
export const PROTOCOL_VERSION = 2
