import '@/app/ui/global.css'
import React from 'react'
import LocalFont from 'next/font/local'
import { Metadata } from 'next'
import { Analytics } from '@/app/_components/analytics'
import { HamburgerProvider } from '@/app/context/HamburgerContext'
import { inter } from './ui/fonts'
import StoreProvider from './StoreProvider'
import SharedLayout from './SharedLayout'
import SessionProviderWrapper from '@/app/_components/SessionProviderWrapper' // ✅ Import the wrapper

export const metadata: Metadata = {
  title: {
    default: 'polemicyst.com',
    template: '%s | polemicyst.com',
  },
  description: 'Founder of Polemicyst.',
  openGraph: {
    title: 'polemicyst.com',
    description: 'Founder of Tyromaniac.',
    url: 'https://polemicyst.com',
    siteName: 'polemicyst.com',
    locale: 'en-US',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  twitter: {
    title: 'Polemicyst',
    card: 'summary_large_image',
  },
  icons: {
    icon: '/favicon/favicon.png',
  },
}

const calSans = LocalFont({
  src: '../../public/fonts/CalSans-SemiBold.ttf',
  variable: '--font-calsans',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[inter.variable, calSans.variable].join(' ')}>
      <head>
        <Analytics />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicon/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon/favicon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon/favicon-16x16.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <link
          rel="mask-icon"
          href="/favicon/safari-pinned-tab.svg"
          color="#000000"
        />
        <link rel="shortcut icon" href="/favicon/favicon.ico" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta
          name="msapplication-config"
          content="/favicon/browserconfig.xml"
        />
        <meta name="theme-color" content="#000" />
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
      </head>
      <body
        className={`${inter.className} dark:bg-[#121212] dark:text-[#E0E0E0] bg-[#F9F9F9] text-[#2E2E2E]`}
      >
        <StoreProvider>
          <HamburgerProvider>
            <SessionProviderWrapper> {/* ✅ Wrap with Client Component */}
              <SharedLayout>{children}</SharedLayout>
            </SessionProviderWrapper>
          </HamburgerProvider>
        </StoreProvider>
      </body>
    </html>
  )
}
