import type { Metadata } from 'next'
import { Inter, Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SentryInit } from '@/components/sentry-init'
import { SWRProvider } from "@/components/swr-provider"
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-inter',
  display: 'swap',
})

const barlowCondensed = Barlow_Condensed({ 
  subsets: ["latin"],
  weight: ['300', '400', '700', '900'],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({ 
  subsets: ["latin"],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LIGAMENT — Vendor Orchestration Engine',
  description: 'The AI-powered vendor orchestration engine for independent agencies. Assemble, manage, align, and pay external vendor partners as one unified team.',
  metadataBase: new URL('https://withligament.com'),
  openGraph: {
    title: 'LIGAMENT — Vendor Orchestration Engine',
    description: 'The AI-powered vendor orchestration engine for independent agencies. Assemble, manage, align, and pay external vendor partners as one unified team.',
    url: 'https://withligament.com',
    siteName: 'Ligament',
    images: [
      {
        url: 'https://withligament.com/ligament-linkedin-icon.png',
        width: 300,
        height: 300,
        alt: 'Ligament Logo',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'LIGAMENT — Vendor Orchestration Engine',
    description: 'The AI-powered vendor orchestration engine for independent agencies.',
    images: ['https://withligament.com/ligament-linkedin-icon.png'],
  },
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        sizes: '32x32',
        type: 'image/x-icon',
      },
      {
        url: '/favicon.png',
        sizes: '32x32',
        type: 'image/png',
      },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable}`}>
      <body className="font-sans antialiased min-h-screen">
        <SentryInit /><SWRProvider>{children}</SWRProvider><Analytics />
      </body>
    </html>
  )
}
