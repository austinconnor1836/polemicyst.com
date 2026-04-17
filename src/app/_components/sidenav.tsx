'use client';

import React from 'react';
import cn from 'classnames';
import { useHamburger } from '../context/HamburgerContext';
import { IconButton } from '@mui/material';
import { SideNavItem } from '../ui/types';
import Link from 'next/link';
import HomeIcon from '@mui/icons-material/Home';
import DescriptionIcon from '@mui/icons-material/Description';
import PaymentIcon from '@mui/icons-material/Payment';
import SportsBasketballIcon from '@mui/icons-material/SportsBasketball';
import WorkIcon from '@mui/icons-material/Work';
import BarChartIcon from '@mui/icons-material/BarChart';
import ListAltIcon from '@mui/icons-material/ListAlt';
import SettingsIcon from '@mui/icons-material/Settings';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import LoginIcon from '@mui/icons-material/Login';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import { useSession } from 'next-auth/react';

interface SidePanelProps {
  onSelectItem?: (item: string) => void;
}

const publicNavItems: SideNavItem[] = [
  { label: 'Home', element: <HomeIcon />, href: '/' },
  { label: 'Blog', element: <DescriptionIcon />, href: '/posts' },
];

const authenticatedNavItems: SideNavItem[] = [
  { label: 'Dashboard', element: <HomeIcon />, href: '/connected-accounts' },
  { label: 'Automation', element: <SettingsIcon />, href: '/settings/automation' },
  { label: 'Lecture Notes', element: <AutoStoriesIcon />, href: '/lecture-notes' },
  { label: 'Blog', element: <DescriptionIcon />, href: '/posts' },
  { label: 'NCAA Seeds', element: <SportsBasketballIcon />, href: '/ncaa-seed-probability' },
  { label: 'Reactions', element: <VideoCallIcon />, href: '/reactions' },
  { label: 'Billing', element: <PaymentIcon />, href: '/billing' },
  { label: 'Jobs', element: <WorkIcon />, href: '/jobs' },
];

const signInItem: SideNavItem = {
  label: 'Sign In',
  element: <LoginIcon />,
  href: '/auth/signin',
};

const SidePanel: React.FC<SidePanelProps> = (props: SidePanelProps) => {
  const { isOpen, closeMenu } = useHamburger();
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  const isAdmin = session?.user?.email === adminEmail;

  let navItems: SideNavItem[];
  if (!isAuthenticated) {
    navItems = [...publicNavItems, signInItem];
  } else if (isAdmin) {
    navItems = [
      ...authenticatedNavItems,
      { label: 'Costs', element: <BarChartIcon />, href: '/admin/costs' },
      { label: 'Logs', element: <ListAltIcon />, href: '/admin/logs' },
    ];
  } else {
    navItems = authenticatedNavItems;
  }

  return (
    <div
      className={cn(
        'h-screen shadow-lg transition-all duration-500 ease-in-out fixed left-0 z-40 bg-background text-foreground glass:bg-transparent glass:shadow-none glass:glass-surface glass:border-r glass:border-white/10', // Tailwind transition and fixed positioning

        {
          'w-auto min-w-[200px]': isOpen, // Large width when opened
          'w-0 overflow-hidden': !isOpen, // Ensure it's completely hidden when closed
        }
      )}
      style={{ marginTop: 'var(--navbar-height)' }} // Adjust margin to be below the navbar
    >
      <ul className="flex flex-col">
        {navItems.map((item, index) => (
          <Link key={item.label} href={item.href} passHref onClick={closeMenu}>
            <li
              key={index}
              className="rounded-md cursor-pointer hover:bg-blue-100 transition-colors flex items-center space-x-2 p-2"
            >
              <IconButton
                key={index}
                aria-label={item.label}
                className="pl-4 text-gray-800 dark:text-gray-300"
              >
                {item.element}
              </IconButton>
              <span
                className={cn('pt-1 transition-all duration-500 ease-in-out', {
                  'opacity-100 translate-x-0': isOpen,
                  'opacity-0 translate-x-[-100%]': !isOpen, // Only transition the label
                })}
              >
                {item.label}
              </span>
            </li>
          </Link>
        ))}
      </ul>
    </div>
  );
};

export default SidePanel;
