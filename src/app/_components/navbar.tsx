'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import HamburgerMenu from './hamburger/hamburger';

const STORAGE_KEY = 'theme-mode';

const Navbar: React.FC = () => {
  const { data: session } = useSession();
  const user = session?.user;
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEY) as 'light' | 'dark' | 'system' | null;
    if (savedTheme) setTheme(savedTheme);
    applyTheme(savedTheme || 'system');
  }, []);

  // Apply theme changes
  const applyTheme = (mode: 'light' | 'dark' | 'system') => {
    document.documentElement.classList.remove('light', 'dark');
    if (mode !== 'system') document.documentElement.classList.add(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  // Cycle through theme modes
  const toggleTheme = () => {
    const modes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const nextMode = modes[(modes.indexOf(theme) + 1) % modes.length];
    setTheme(nextMode);
    applyTheme(nextMode);
  };

  return (
    <nav className="navbar dark:bg-[#121212] dark:text-slate-400 bg-[#F9F9F9] text-[#2E2E2E] fixed top-0 left-0 z-50 w-full shadow-lg">
      <div className="flex justify-between items-center px-4">
        <HamburgerMenu />
        <div className="flex items-center gap-4 relative">
          {/* Account Icon Button */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="focus:outline-none">
            {user ? (
              <img src={user.image || '/default-avatar.png'} alt="User Avatar" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center text-white">
                ?
              </div>
            )}
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-lg">
              {user ? (
                <>
                  <p className="px-4 py-2 text-sm">{user.name || 'User'}</p>
                  <button
                    onClick={() => signOut()}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <button
                  onClick={() => signIn('google')}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Login
                </button>
              )}

              {/* Theme Switcher */}
              <button
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700 mt-2"
                onClick={toggleTheme}
              >
                <span>Theme: {theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                {theme === 'light' ? <WbSunnyIcon /> : theme === 'dark' ? <NightsStayIcon /> : <Brightness4Icon />}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
