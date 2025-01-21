// /app/_components/ClientLayout.tsx
'use client';

import React, { useState } from 'react';
import ChatBot from './_components/chat/chatbot';
import ChatBar from './_components/chat/chatbar';
import SidePanel from './_components/sidenav';
import { selectIsMenuOpen } from '@/lib/slices/uiSlice';
import { useAppSelector } from '@/lib/hooks';
import { usePathname } from 'next/navigation';
import HomeIcon from '@mui/icons-material/Home'; 
import PostAddIcon from '@mui/icons-material/PostAdd'; 
import CategoryIcon from '@mui/icons-material/Category'; 
import ArchiveIcon from '@mui/icons-material/Archive'; 
import { SideNavItem } from './ui/types';


const ClientLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openChats, setOpenChats] = useState<number[]>([]);
  const [splitView, setSplitView] = useState(false);
  const [theme, setTheme] = useState('light');
  const isMenuOpen = useAppSelector(selectIsMenuOpen);
  const sideNavItems: SideNavItem[] = [
  { label: 'Home', element: <HomeIcon />, href: '/' },
];

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
    <div className={`relative h-screen overflow-hidden ${theme === 'dark' ? 'dark' : 'light'}`}>
      <>
        {isMenuOpen && pathname !== '/' ? (
          <div className="mt-24 flex h-full">
            <SidePanel items={sideNavItems} />
            <div className="flex-1 overflow-y-auto">{children}</div>
          </div>
        ) : (
          <div className={`mt-2`}>
            {children}
            {openChats.map((chatId) => (
              <ChatBot key={chatId} id={chatId} onClose={handleCloseChat} />
            ))}
          </div>
        )}
        <ChatBar openChats={openChats} onSelectChat={handleOpenChat} />
      </>
    </div>
  );
};

export default ClientLayout;
