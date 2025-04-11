'use client';

import { usePlatformContext } from './PlatformContext';
import { FaFacebook, FaInstagram, FaYoutube } from 'react-icons/fa';
import { SiBluesky } from 'react-icons/si';
import { CheckCircle, Cancel, RadioButtonUnchecked } from '@mui/icons-material';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const icons: Record<string, React.ReactNode> = {
  facebook: <FaFacebook className="text-blue-600" />,
  instagram: <FaInstagram className="text-pink-500" />,
  google: <FaYoutube className="text-red-600" />,
  bluesky: <SiBluesky className="text-blue-400" />,
};

const PlatformStatusBar = () => {
  const {
    isAuthenticated,
    selectedPlatforms,
    togglePlatform,
    refreshAuthStatus,
  } = usePlatformContext();
  const { data: session } = useSession();
  const router = useRouter();

  const handleAuthToggle = async (provider: string) => {
    if (isAuthenticated[provider]) {
      // Logout
      const effectiveProvider = provider === 'instagram' ? 'facebook' : provider;
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: effectiveProvider }),
      });
    } else {
      // Connect
      if (provider === 'bluesky') {
        router.push(`/auth/signin?provider=bluesky`);
      } else {
        await signIn(provider, { callbackUrl: '/clips-genie' });
      }
    }

    setTimeout(() => {
      refreshAuthStatus();
    }, 1000);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
      {Object.entries(icons).map(([provider, icon]) => {
        const isSelected = selectedPlatforms.includes(provider);
        const isAuth = isAuthenticated[provider];

        return (
          <div
            key={provider}
            className={`flex items-center gap-3 text-sm px-3 py-2 rounded-md shadow-sm border hover:shadow-md transition cursor-pointer ${
              isSelected ? 'bg-blue-100 dark:bg-blue-800' : 'bg-white dark:bg-gray-900'
            }`}
            onClick={() => togglePlatform(provider)}
          >
            {icon}
            <span className="capitalize">{provider}</span>

            {isAuth ? (
              <CheckCircle className="text-green-500" />
            ) : (
              <Cancel className="text-gray-400" />
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAuthToggle(provider);
              }}
              className={`text-xs underline ${
                isAuth ? 'text-red-500' : 'text-blue-500'
              }`}
            >
              {isAuth ? 'Logout' : 'Connect'}
            </button>

            {isSelected ? (
              <RadioButtonUnchecked className="text-blue-500" />
            ) : (
              <RadioButtonUnchecked className="text-gray-400" />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PlatformStatusBar;
