'use client';

import React from 'react';
import RotatingButton from './rotating-button/rotating-button';
import HamburgerMenu from './hamburger';

const Navbar: React.FC = () => {
  return (
    <nav className="dark:bg-slate-900 dark:text-slate-400 fixed top-0 left-0 z-50 w-full shadow-lg">
      <div className="flex justify-between items-center px-4">
        <HamburgerMenu />
        <RotatingButton />
      </div>
    </nav>
  );
};

export default Navbar;