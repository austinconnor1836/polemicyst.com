'use client';

import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { usePlatformContext } from './PlatformContext';
import { FaFacebook, FaTwitter, FaInstagram, FaYoutube } from 'react-icons/fa';
import { SiBluesky } from 'react-icons/si';
import { CheckCircle, RadioButtonUnchecked } from '@mui/icons-material';
import { Button } from '@/components/ui/button';

const platforms = [
  { name: 'Bluesky', icon: <SiBluesky className="text-blue-500 text-xl" />, provider: 'bluesky' },
  {
    name: 'Facebook',
    icon: <FaFacebook className="text-blue-600 text-xl" />,
    provider: 'facebook',
  },
  {
    name: 'Instagram',
    icon: <FaInstagram className="text-pink-500 text-xl" />,
    provider: 'instagram',
  },
  { name: 'YouTube', icon: <FaYoutube className="text-red-600 text-xl" />, provider: 'google' },
  // { name: "Twitter", icon: <FaTwitter className="text-blue-400 text-xl" />, provider: "twitter" },
];

const PlatformList = () => {
  const router = useRouter();
  const { selectedPlatforms, togglePlatform, isAuthenticated, refreshAuthStatus } =
    usePlatformContext();
  const { data: session } = useSession();

  const handleAuthenticate = async (e: React.MouseEvent, provider: string) => {
    e.stopPropagation(); // Prevent toggling selection when clicking "Connect"

    if (provider === 'bluesky') {
      router.push(`/auth/signin?provider=bluesky`); // Redirect to custom Bluesky sign-in page
    } else {
      await signIn(provider, { callbackUrl: '/clips-genie' });
    }

    // Refresh authentication status after a short delay
    setTimeout(() => {
      refreshAuthStatus();
    }, 1000);
  };

  const handleLogout = async (e: React.MouseEvent, provider: string) => {
    e.stopPropagation();

    // If user logs out from Instagram, treat it as Facebook
    const effectiveProvider = provider === 'instagram' ? 'facebook' : provider;

    const response = await fetch(`/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: effectiveProvider }), // ✅ Ensure provider is sent
    });

    if (response.ok) {
      console.log(`✅ Successfully logged out from ${effectiveProvider}`);
      refreshAuthStatus();
    } else {
      console.error('❌ Logout failed:', await response.json());
    }
  };

  return (
    <div className="md:w-1/4 bg-gray-100 dark:bg-background p-4 rounded-lg">
      <h3 className="text-lg font-semibold mb-2">Platforms</h3>
      <ul className="space-y-2">
        {platforms.map(({ name, icon, provider }) => {
          let authStatus = session && isAuthenticated[provider];

          // ✅ Automatically authenticate Instagram if Facebook is authenticated
          if (provider === 'instagram' && isAuthenticated['facebook']) {
            authStatus = true;
          }

          const isSelected = selectedPlatforms.includes(provider);

          return (
            <li
              key={provider}
              className={`flex items-center justify-between p-2 cursor-pointer rounded-md transition ${
                isSelected
                  ? 'bg-blue-200 dark:bg-blue-700'
                  : 'hover:bg-gray-200 dark:hover:bg-surface'
              }`}
              onClick={() => togglePlatform(provider)}
            >
              <span className="flex items-center gap-2">
                {icon}
                {name}
              </span>

              <div className="flex items-center gap-2">
                {authStatus ? (
                  <Button
                    onClick={(e) => handleLogout(e, provider)}
                    variant="link"
                    size="sm"
                    className="h-auto py-0 text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Logout
                  </Button>
                ) : name !== 'Instagram' ? (
                  <Button
                    onClick={(e) => handleAuthenticate(e, provider)}
                    variant="link"
                    size="sm"
                    className="h-auto py-0 text-sm"
                  >
                    Connect
                  </Button>
                ) : null}
                {isSelected ? (
                  <CheckCircle className="text-blue-500" />
                ) : (
                  <RadioButtonUnchecked className="text-gray-400" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PlatformList;
