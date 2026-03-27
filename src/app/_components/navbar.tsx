'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HamburgerMenu from './hamburger/hamburger';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'theme-mode';

const Navbar: React.FC = () => {
  const { data: session } = useSession();
  const user = session?.user;
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'glass' | 'system'>('system');

  const menuRef = useRef<HTMLDivElement>(null);

  const getSystemIsDark = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  };

  const applyTheme = (mode: 'light' | 'dark' | 'glass' | 'system') => {
    const isDark = mode === 'dark' || mode === 'glass' || (mode === 'system' && getSystemIsDark());
    document.documentElement.classList.toggle('dark', isDark);

    if (mode === 'glass') {
      document.documentElement.setAttribute('data-theme', 'glass');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    localStorage.setItem(STORAGE_KEY, mode);
  };

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEY) as
      | 'light'
      | 'dark'
      | 'glass'
      | 'system'
      | null;
    if (savedTheme) setTheme(savedTheme);
    applyTheme(savedTheme || 'system');
  }, []);

  // Keep system theme in sync when `Theme: System` is selected.
  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;

    const handler = () => applyTheme('system');

    // Safari < 14 uses addListener/removeListener
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
    else mql.addListener(handler);

    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, [theme]);

  // Cycle through theme modes
  const toggleTheme = () => {
    const modes: ('light' | 'dark' | 'glass' | 'system')[] = ['light', 'dark', 'glass', 'system'];
    const nextMode = modes[(modes.indexOf(theme) + 1) % modes.length];
    setTheme(nextMode);
    applyTheme(nextMode);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <nav className="navbar bg-background text-foreground fixed top-0 left-0 z-50 w-full shadow-lg glass:bg-transparent glass:shadow-none glass:glass-surface glass:border-b glass:border-white/10">
      <div className="flex justify-between items-center px-4 py-2">
        <HamburgerMenu />
        <div className="flex items-center gap-4 relative">
          {/* Account Icon Button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full p-0"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {user ? (
              <img
                src={user.image || '/default-avatar.png'}
                alt="User Avatar"
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center text-white">
                ?
              </div>
            )}
          </Button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 mt-40 w-48 bg-surface border border-border rounded shadow-lg glass:bg-[rgba(255,255,255,0.08)] glass:border-white/10 glass:backdrop-blur-xl glass:shadow-[var(--glass-shadow)]"
            >
              {user ? (
                <>
                  <p className="px-4 py-2 text-sm">{user.name || 'User'}</p>
                  <Button
                    variant="ghost"
                    className="w-full justify-start rounded-none px-4"
                    onClick={() => signOut()}
                  >
                    Logout
                  </Button>
                </>
              ) : (
                <Button variant="ghost" className="w-full justify-start rounded-none px-4" asChild>
                  <a href="/auth/signin">Sign In</a>
                </Button>
              )}

              {/* Theme Switcher */}
              <Button
                variant="ghost"
                className="mt-2 w-full justify-between rounded-none px-4"
                onClick={toggleTheme}
              >
                <span>Theme: {theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                {theme === 'light' ? (
                  <WbSunnyIcon />
                ) : theme === 'dark' ? (
                  <NightsStayIcon />
                ) : theme === 'glass' ? (
                  <AutoAwesomeIcon />
                ) : (
                  <Brightness4Icon />
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
