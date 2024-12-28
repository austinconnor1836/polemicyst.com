'use client';

import React, { useState } from 'react';
import SidePanel from './_components/sidenav';
import { selectIsMenuOpen } from '@/lib/slices/uiSlice';
import { useAppSelector } from '@/lib/hooks';
import { usePathname } from 'next/navigation';
import HomeIcon from '@mui/icons-material/Home'; 
import PostAddIcon from '@mui/icons-material/PostAdd'; 
import CategoryIcon from '@mui/icons-material/Category'; 
import ArchiveIcon from '@mui/icons-material/Archive'; 
import { SideNavItem } from './ui/types';
import Navbar from './_components/navbar';
import { useTheme } from './context/ThemeContext';

const ClientLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const isMenuOpen = useAppSelector(selectIsMenuOpen);
  const sideNavItems: SideNavItem[] = [
    { label: 'Home', element: <HomeIcon /> },
    { label: 'New Post', element: <PostAddIcon /> },
    { label: 'Categories', element: <CategoryIcon /> },
    { label: 'Archives', element: <ArchiveIcon /> },
  ];

  const pathname = usePathname();

  return (
    <div className={`relative h-screen overflow-hidden ${theme === 'dark' ? 'dark' : 'light'}`}>
      <div className="flex flex-col h-full">
        <div className="fixed top-0 left-0 w-full z-50">
          <Navbar />
        </div>
        <div className="flex flex-1 mt-16">
          {isMenuOpen && pathname !== '/' && (
            <SidePanel items={sideNavItems} />
          )}
          <div className="flex-1 overflow-y-auto">
            <div className="mt-5 pb-24">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientLayout;