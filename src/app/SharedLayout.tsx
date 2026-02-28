'use client';

import React from 'react';
import Navbar from './_components/navbar';
import SidePanel from './_components/sidenav';
import GlassAmbientBackground from './_components/GlassAmbientBackground';

const SharedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <>
      <GlassAmbientBackground />
      <Navbar />
      <SidePanel />
      <main className="pt-[var(--navbar-height)]">{children}</main>
    </>
  );
};

export default SharedLayout;
