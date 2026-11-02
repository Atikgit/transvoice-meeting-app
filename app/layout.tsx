export const dynamic = 'force-dynamic'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BRAND, TITLE_TEMPLATE } from '@/lib/brand'

export const metadata: Metadata = {
  title: { default: BRAND.seo.title, template: TITLE_TEMPLATE },
  description: BRAND.seo.description,
  generator: 'v0.app',
  applicationName: BRAND.seo.applicationName,
  openGraph: {
    title: BRAND.seo.title,
    description: BRAND.seo.description,
    url: BRAND.seo.url,
    siteName: BRAND.seo.siteName,
    images: [BRAND.seo.image],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: BRAND.seo.title,
    description: BRAND.seo.description,
    images: [BRAND.seo.image.url],
  },
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
