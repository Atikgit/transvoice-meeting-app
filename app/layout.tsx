export const dynamic = 'force-dynamic'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'
import './globals.css'
import { BRAND, TITLE_TEMPLATE } from '@/lib/brand'

export const metadata: Metadata = {
  title: { default: BRAND.appName, template: TITLE_TEMPLATE },
  applicationName: BRAND.appName,
  description: `${BRAND.description} in ${LANGUAGES_AND_VOICES}.`,
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0e16',
  // Lets the meeting controls pad for the home indicator (env(safe-area-inset-bottom)).
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-[#0b0e16]">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
