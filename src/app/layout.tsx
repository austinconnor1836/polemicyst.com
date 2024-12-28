import "@/app/global.css";
import React from 'react';
import LocalFont from "next/font/local";
import { HamburgerProvider } from '@/app/context/HamburgerContext';
import { inter, montserrat } from "./ui/fonts";
import ClientLayout from './client-layout';
import Navbar from './_components/navbar';
import StoreProvider from "./StoreProvider";
import { ThemeProvider } from "./context/ThemeContext";
import Particles from "./_components/particles";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon/polemicyst-logo.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <link
          rel="mask-icon"
          href="/favicon/safari-pinned-tab.svg"
          color="#000000"
        />
        <link rel="shortcut icon" href="/favicon/polemicyst-logo.png" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta
          name="msapplication-config"
          content="/favicon/browserconfig.xml"
        />
        <meta name="theme-color" content="#000" />
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
      </head>
      <body
        className={`${inter.className} ${montserrat.variable} dark:bg-slate-900 dark:text-slate-400`}
      >
        <Particles
        className="absolute inset-0 -z-10 animate-fade-in"
        quantity={100}
      />
        <StoreProvider>
          <HamburgerProvider>
            <ThemeProvider>
              <Navbar />
              <ClientLayout>
                {children}
              </ClientLayout>
            </ThemeProvider>
          </HamburgerProvider>
        </StoreProvider>
      </body>
    </html>
  );
}