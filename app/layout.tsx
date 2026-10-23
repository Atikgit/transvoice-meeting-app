export const dynamic = 'force-dynamic'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { LANGUAGES_AND_VOICES } from '@/lib/transvoice/languages'
import './globals.css'

export const metadata: Metadata = {
  title: 'TransVoice Meet',
  description: `Secure, live voice-translated meetings in ${LANGUAGES_AND_VOICES}.`,
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0e16',
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
