import "@/app/ui/global.css";
import { Inter } from "next/font/google";
import LocalFont from "next/font/local";
import { Metadata } from "next";
import { Analytics } from "@/app/_components/analytics";
import { ThemeSwitcher } from "./_components/theme-switcher";
import cn from "classnames";
import Navbar from "./_components/navbar";
import { inter } from "./ui/fonts";
import { useState } from "react";
import ChatBar from "./_components/chat/chatbar";
import ChatBot from "./_components/chat/chatbot";
import SplitViewButton from "./_components/chat/splitview-button";
import ClientLayout from "./client-layout";

export const metadata: Metadata = {
  title: {
    default: "austinconnor.com",
    template: "%s | austinconnor.com",
  },
  description: "Founder of Tyromaniac.",
  openGraph: {
    title: "austinconnor.com",
    description:
      "Founder of Tyromaniac.",
    url: "https://austinconnor.com",
    siteName: "austinconnor.com",
    locale: "en-US",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  twitter: {
    title: "austinconnor",
    card: "summary_large_image",
  },
  icons: {
    icon: "/favicon/favicon.png",
  },
};

const calSans = LocalFont({
  src: "../../public/fonts/CalSans-SemiBold.ttf",
  variable: "--font-calsans",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openChats, setOpenChats] = useState<number[]>([]);
  const [splitView, setSplitView] = useState(false);

  const handleOpenChat = (id: number) => {
    setOpenChats((prevChats) => [...prevChats, id]);
  };

  const handleCloseChat = (id: number) => {
    setOpenChats((prevChats) => prevChats.filter((chatId) => chatId !== id));
  };

  const handleToggleSplitView = () => {
    setSplitView(!splitView);
  };
  return (
    <html lang="en" className={[inter.variable, calSans.variable].join(" ")}>
      {/* <html lang="en" className={`${inter.className} antialiased`}> */}
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
        // className={cn(inter.className, "dark:bg-slate-900 dark:text-slate-400")}
        className={`${inter.className} dark:bg-slate-900 dark:text-slate-400`}
      >
        <ClientLayout>
          <Navbar />
          <ThemeSwitcher />
          <SplitViewButton onToggleSplitView={handleToggleSplitView} />

          {splitView ? (
            <div className="flex h-full">
              <div className="w-1/3 bg-gray-100 border-r">
                {openChats.map((chatId) => (
                  <ChatBot key={chatId} id={chatId} onClose={handleCloseChat} />
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">{children}</div>
            </div>
          ) : (
            <>
              {children}
              {openChats.map((chatId) => (
                <ChatBot key={chatId} id={chatId} onClose={handleCloseChat} />
              ))}
            </>
          )}

          <ChatBar openChats={openChats} onSelectChat={handleOpenChat} />
        </ClientLayout>
      </body>
    </html>
  );
}
