'use client';

import React from 'react';
import Image from 'next/image';
import RotatingButton from './rotating-button/rotating-button';
import { useTheme } from '../context/ThemeContext';

const Navbar: React.FC = () => {
  const { theme } = useTheme();

  return (
    <nav className="flex items-center justify-between dark:bg-slate-900 dark:text-slate-400 fixed top-0 left-0 z-50 w-full shadow-lg px-4 py-2 h-[84px]">
      <div className="flex-grow flex justify-center">
        {theme === 'light' ? <Image
          src="/images/polemicyst-title-light.png"
          alt="Polemicyst"
          width={200} // Adjust the width as needed
          height={50} // Adjust the height as needed
          className="object-contain"
        /> : <Image
          src="/images/polemicyst-title.png"
          alt="Polemicyst"
          width={200} // Adjust the width as needed
          height={50} // Adjust the height as needed
          className="object-contain"
        />}
      </div>
      <div className="flex items-center space-x-4">
        <RotatingButton />
      </div>
    </nav>
  );
};

export default Navbar;