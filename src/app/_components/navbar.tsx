// /app/_components/navbar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import { usePathname } from 'next/navigation';
import CircleAnimation from './circle-animation/circle-animation';
import RotatingButton from './rotating-button/rotating-button';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// interface NavBarProps {
  // onToggleSplitView: () => void;
  // onThemeSwitch: () => void;
// }

// const Navbar: React.FC<NavBarProps> = ({ onToggleSplitView, onThemeSwitch }) => {
const Navbar: React.FC = () => {
  const pathname = usePathname();

  // Check if the current route is the root (/)
  const isRootRoute = pathname === '/';

  return (
    <nav className="dark:bg-slate-900 dark:text-slate-400 fixed top-0 left-0 z-50 w-full shadow-lg">
    {/* // <nav className="fixed top-0 left-0 z-50 w-full p-4 bg-white/70 shadow-lg backdrop-blur-sm"> */}
      {/* <div className="container mx-auto flex justify-end items-center"> */}
      <div className="flex justify-end items-center">
        <Link href="/posts" className="transition-colors mr-6">
          Curious?
        </Link>
        {/* <CircleAnimation /> */}
        <RotatingButton />
        <div className="relative flex space-x-4">
          <button
            // onClick={onThemeSwitch}
            className="switch"
          >
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
