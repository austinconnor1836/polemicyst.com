import './ui/global.css';
import React from 'react';
import LocalFont from 'next/font/local';
import { Metadata } from 'next';
import { headers } from 'next/headers';
import { Analytics } from './_components/analytics';
import { HamburgerProvider } from './context/HamburgerContext';
import { inter } from './ui/fonts';
import StoreProvider from './StoreProvider';
import SharedLayout from './SharedLayout';
import SessionProviderWrapper from './_components/SessionProviderWrapper'; // ✅ Import the wrapper
import CookieBanner from '@/components/CookieBanner';

function getSiteLabel(host: string): string {
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return 'local:clipfire';
  }
  if (host.startsWith('dev.')) {
    return 'dev:clipfire';
  }
  return 'Clipfire';
}

const PRODUCT_TITLE = 'Clipfire — Turn long-form video into viral clips, automatically';
const PRODUCT_DESCRIPTION =
  'Turn long-form video into viral, platform-ready clips — automatically, with AI scoring tuned for Reels, Shorts, and TikTok.';
// TODO: replace public/og-image.jpg placeholder with a designed 1200x630 social card.
const OG_IMAGE = '/og-image.jpg';

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('host') ?? '';
  const siteLabel = getSiteLabel(host);
  const isProd = siteLabel === 'Clipfire';

  return {
    title: {
      default: isProd ? PRODUCT_TITLE : siteLabel,
      template: `%s | ${siteLabel}`,
    },
    description: PRODUCT_DESCRIPTION,
    openGraph: {
      title: PRODUCT_TITLE,
      description: PRODUCT_DESCRIPTION,
      url: 'https://polemicyst.com',
      siteName: 'Clipfire',
      locale: 'en-US',
      type: 'website',
      images: [
        {
          url: OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Clipfire — AI-powered viral clip generation',
        },
      ],
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
      title: PRODUCT_TITLE,
      description: PRODUCT_DESCRIPTION,
      card: 'summary_large_image',
      images: [OG_IMAGE],
    },
    icons: {
      icon: '/favicon/favicon.png',
    },
  };
}

const calSans = LocalFont({
  src: '../../public/fonts/CalSans-SemiBold.ttf',
  variable: '--font-calsans',
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[inter.variable, calSans.variable].join(' ')}>
      <head>
        <Analytics />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16.png" />
        <link rel="manifest" href="/favicon/manifest.json" />
        <link rel="mask-icon" href="/favicon/safari-pinned-tab.svg" color="#000000" />
        <link rel="shortcut icon" href="/favicon/favicon.ico" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-config" content="/favicon/browserconfig.xml" />
        <meta name="theme-color" content="#000" />
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
      </head>
      <body className={`${inter.className} bg-background text-foreground`}>
        <StoreProvider>
          <HamburgerProvider>
            <SessionProviderWrapper>
              {' '}
              {/* ✅ Wrap with Client Component */}
              <SharedLayout>{children}</SharedLayout>
            </SessionProviderWrapper>
          </HamburgerProvider>
        </StoreProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
