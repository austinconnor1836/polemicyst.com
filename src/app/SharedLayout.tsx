'use client';

import React from 'react';
import Navbar from './_components/navbar';
import SidePanel from './_components/sidenav';
import { ThemeSwitcher } from './_components/theme-switcher';

const SharedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <>
      <ThemeSwitcher />
      <Navbar />
      <SidePanel />
      <main>{children}</main>
    </>
  );
};

export default SharedLayout;
