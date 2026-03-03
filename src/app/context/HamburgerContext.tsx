'use client';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface HamburgerContextProps {
  isOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
}

// Create the context
const HamburgerContext = createContext<HamburgerContextProps | undefined>(undefined);

// Hook to use the context
export const useHamburger = () => {
  const context = useContext(HamburgerContext);
  if (!context) {
    throw new Error('useHamburger must be used within a HamburgerProvider');
  }
  return context;
};

// Provider component
export const HamburgerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  return (
    <HamburgerContext.Provider value={{ isOpen, toggleMenu, closeMenu }}>
      {children}
    </HamburgerContext.Provider>
  );
};
