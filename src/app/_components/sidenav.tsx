import React from 'react';
import cn from 'classnames';
import { useHamburger } from '@/app/context/HamburgerContext'; // Import context
import { IconButton } from '@mui/material';
import { SideNavItem } from '../ui/types';
import Link from 'next/link';
import HomeIcon from '@mui/icons-material/Home'; 

interface SidePanelProps {
  onSelectItem?: (item: string) => void;
}

const sideNavItems: SideNavItem[] = [
  { label: 'Home', element: <HomeIcon />, href: '/' },
  // Add other items as needed
];

const SidePanel: React.FC<SidePanelProps> = (props: SidePanelProps) => {
  const { isOpen } = useHamburger(); // Use the isOpen state from context

  return (
    <div
      className={cn(
        'h-screen shadow-lg transition-all duration-500 ease-in-out fixed left-0 z-40 bg-white dark:bg-gray-800', // Tailwind transition and fixed positioning

        {
          'w-auto min-w-[200px]': isOpen,  // Large width when opened
          'w-0 overflow-hidden': !isOpen, // Ensure it's completely hidden when closed
        },
      )}
      style={{ top: '6.28rem' }} // Adjust margin to be below the navbar
    >
      <ul className="flex flex-col">
        {sideNavItems.map((item, index) => (
          <li
            key={index}
            className="rounded-md cursor-pointer hover:bg-blue-100 transition-colors flex items-center space-x-2 p-2"
          >
            <Link href={item.href} passHref>
              <IconButton key={index} aria-label={item.label} className='pl-4 text-gray-800 dark:text-gray-300'>
                {item.element}
              </IconButton>
            </Link>
            <span
              className={cn(
                'pt-1 transition-all duration-500 ease-in-out',
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