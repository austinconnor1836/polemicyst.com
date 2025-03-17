'use client';

import React, { useState } from 'react';
import RotatingButton from './theme-switcher/rotating-button';
import HamburgerMenu from './hamburger/hamburger';
import { useSession, signIn, signOut } from 'next-auth/react';

const Navbar: React.FC = () => {
  const { data: session } = useSession();
  const user = session?.user;
  const [menuOpen, setMenuOpen] = useState(false);

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
            <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-lg">
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
            </div>
          )}
          <RotatingButton />
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
