'use client';

import React from 'react';
import cn from 'classnames';
import { useHamburger } from '@/app/context/HamburgerContext'; // Import context
import HamburgerMenu from './hamburger';
import { Button, IconButton } from '@mui/material';
import { SideNavItem } from '../ui/types';

interface SidePanelProps {
  items: SideNavItem[];
  onSelectItem?: (item: string) => void;
}

const SidePanel: React.FC<SidePanelProps> = (props: SidePanelProps) => {
  const { items } = props;
  const { isOpen } = useHamburger(); // Use the isOpen state from context

  return (
    <div
      className={cn(
        'h-screen shadow-lg transition-all duration-500 ease-in-out', // Tailwind transition
        {
          'w-16': !isOpen, // Small width when closed
          'w-64': isOpen,  // Large width when opened
        }
      )}
      style={{ marginTop: '0.3rem' }}
    >
      <div className="ml-1.5 mt-1"> 
        <HamburgerMenu />
      </div>
      {/* <HamburgerMenu /> */}
      <ul className="pr-2 space-y-2 flex flex-col">
        {items.map((item, index) => (
          <li
            key={index}
            className="rounded-md cursor-pointer hover:bg-blue-100 transition-colors flex items-center space-x-2"
          >
            <IconButton key={index} aria-label={item.label} className='pl-4 text-gray-800 dark:text-gray-300'>
              {item.element}
            </IconButton>
            <span
              className={cn(
                'pt-1 transition-all duration-300 ease-in-out',
                {
                  'opacity-100 translate-x-0': isOpen,
                  'opacity-0 translate-x-[-100%]': !isOpen, // Only transition the label
                }
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SidePanel;
