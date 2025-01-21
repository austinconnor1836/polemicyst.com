'use client'

import Link from "next/link";
import React, { useState } from "react";
import Particles from "@/app/_components/particles";
import { lusitana } from "./ui/fonts";
import { useAppSelector } from "@/lib/hooks";
import { selectIsMenuOpen } from "@/lib/slices/uiSlice";
import { usePathname } from "next/navigation";
import ChatBot from "./_components/chat/chatbot";
import ChatBar from "./_components/chat/chatbar";
console.log('OPEN_AI_API_KEY', process.env.NEXT_PUBLIC_OPEN_AI_API_KEY);

const navigation = [
  { name: "Blog", href: "/posts" },
  // { name: "Playground - Custom Components - Context Menu", href: "/playground/custom-components/custom-context-menu" },
  // { name: "Playground - Custom Components - Side Nav", href: "/playground/custom-components/sidenav" },
];

export default function Home() {
  const [openChats, setOpenChats] = useState<number[]>([]);
  const isMenuOpen = useAppSelector(selectIsMenuOpen);

  const handleOpenChat = (id: number) => {
    if (!openChats.includes(id)) {
      setOpenChats((prevChats) => [...prevChats, id]);
    }
  };

  const handleCloseChat = (id: number) => {
    setOpenChats((prevChats) => prevChats.filter((chatId) => chatId !== id));
  };

  const pathname = usePathname();

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen overflow-hidden bg-gradient-to-tl from-black via-zinc-600/20 to-black">
      <nav className="my-16 animate-fade-in">
        <ul className="flex items-center justify-center gap-4">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm duration-500 text-zinc-500 hover:text-zinc-300"
            >
              {item.name}
            </Link>
          ))}
        </ul>
      </nav>
      <div className="hidden w-screen h-px animate-glow md:block animate-fade-left bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />
      {isMenuOpen && pathname !== '/' ? (
          <div className="flex h-full">
            chat bot
          </div>
        ) : (
          <>
            {openChats.map((chatId) => (
              <ChatBot key={chatId} id={chatId} onClose={handleCloseChat} />
            ))}
          </>
        )}
        <ChatBar openChats={openChats} onSelectChat={handleOpenChat} />
      <Particles
        className="absolute inset-0 -z-10 animate-fade-in"
        quantity={100}
      />
      <h1 className={`${lusitana} py-3.5 px-0.5 z-10 text-4xl text-transparent duration-1000 bg-white cursor-default text-edge-outline animate-title font-display sm:text-6xl md:text-9xl whitespace-nowrap bg-clip-text`}>
        POLEMICYST
      </h1>

      <div className="hidden w-screen h-px animate-glow md:block animate-fade-right bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />
      
    </div>
  );

}
