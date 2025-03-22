"use client";

import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { usePlatformContext } from "./PlatformContext";
import { FaFacebook, FaTwitter, FaInstagram, FaYoutube } from "react-icons/fa";
import { SiBluesky } from "react-icons/si";
import { CheckCircle, RadioButtonUnchecked } from "@mui/icons-material";
import { isMobile } from '@/lib/isMobile';
import { openFacebookOAuth } from "@/lib/openFacebookOAuth";

const platforms = [
  { name: "Bluesky", icon: <SiBluesky className="text-blue-500 text-xl" />, provider: "bluesky" },
  { name: "Facebook", icon: <FaFacebook className="text-blue-600 text-xl" />, provider: "facebook" },
  { name: "Instagram", icon: <FaInstagram className="text-pink-500 text-xl" />, provider: "instagram" },
  { name: "YouTube", icon: <FaYoutube className="text-red-600 text-xl" />, provider: "google" },
  // { name: "Twitter", icon: <FaTwitter className="text-blue-400 text-xl" />, provider: "twitter" },
];

const PlatformList = () => {
  const router = useRouter();
  const { selectedPlatforms, togglePlatform, isAuthenticated, refreshAuthStatus } = usePlatformContext();
  const { data: session } = useSession();

  // const handleAuthenticate = async (e: React.MouseEvent, provider: string) => {
  //   e.stopPropagation();

  //   if (provider === "bluesky") {
  //     router.push(`/auth/signin?provider=bluesky`);
  //   } else if (isMobile()) {
  //     // Open Facebook login in a new window on mobile to simulate native behavior
  //     const width = 500;
  //     const height = 600;
  //     const left = (window.innerWidth - width) / 2;
  //     const top = (window.innerHeight - height) / 2;

  //     const authWindow = window.open(
  //       `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(window.location.origin + "/clips-genie")}`,
  //       "_blank",
  //       `width=${width},height=${height},top=${top},left=${left}`
  //     );

  //     if (authWindow) {
  //       const timer = setInterval(() => {
  //         if (authWindow.closed) {
  //           clearInterval(timer);
  //           refreshAuthStatus(); // Refresh after the window closes
  //         }
  //       }, 500);
  //     }
  //   } else {
  //     await signIn(provider, { callbackUrl: "/clips-genie" });
  //     setTimeout(() => {
  //       refreshAuthStatus();
  //     }, 1000);
  //   }
  // };

  // const handleAuthenticate = async (e: React.MouseEvent, provider: string) => {
  //   e.stopPropagation(); // Prevent toggling selection when clicking "Connect"

  //   if (provider === "bluesky") {
  //     router.push(`/auth/signin?provider=bluesky`); // Redirect to custom Bluesky sign-in page
  //   } else {
  //     await signIn(provider, { callbackUrl: '/clips-genie' });
  //   }

  //   // Refresh authentication status after a short delay
  //   setTimeout(() => {
  //     refreshAuthStatus();
  //   }, 1000);
  // };

  const handleAuthenticate = async (e: React.MouseEvent, provider: string) => {
  e.stopPropagation();
  console.log('provider', provider);

  if (provider === "bluesky") {
    router.push(`/auth/signin?provider=bluesky`);
  } else if (provider === "facebook") {
    openFacebookOAuth(); // ✅ Redirect that opens FB app if possible
  } else {
    await signIn(provider, { callbackUrl: "/clips-genie" });
    setTimeout(() => {
      refreshAuthStatus();
    }, 1000);
  }
};


  const handleLogout = async (e: React.MouseEvent, provider: string) => {
    e.stopPropagation();


    // If user logs out from Instagram, treat it as Facebook
    const effectiveProvider = provider === "instagram" ? "facebook" : provider;

    const response = await fetch(`/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: effectiveProvider }), // ✅ Ensure provider is sent
    });

    if (response.ok) {
      console.log(`✅ Successfully logged out from ${effectiveProvider}`);
      refreshAuthStatus();
    } else {
      console.error("❌ Logout failed:", await response.json());
    }
  };




  return (
    <div className="md:w-1/4 bg-gray-100 dark:bg-[#1e1e1e] p-4 rounded-lg">
      <h3 className="text-lg font-semibold mb-2">Platforms</h3>
      <ul className="space-y-2">
        {platforms.map(({ name, icon, provider }) => {
          let authStatus = session && isAuthenticated[provider];

          // ✅ Automatically authenticate Instagram if Facebook is authenticated
          if (provider === "instagram" && isAuthenticated["facebook"]) {
            authStatus = true;
          }

          const isSelected = selectedPlatforms.includes(provider);

          return (
            <li
              key={provider}
              className={`flex items-center justify-between p-2 cursor-pointer rounded-md transition ${isSelected ? "bg-blue-200 dark:bg-blue-700" : "hover:bg-gray-200 dark:hover:bg-[#292c35]"
                }`}
              onClick={() => togglePlatform(provider)}
            >
              <span className="flex items-center gap-2">
                {icon}
                {name}
              </span>

              <div className="flex items-center gap-2">
                {authStatus ? (
                  <button
                    onClick={(e) => handleLogout(e, provider)}
                    className="text-sm text-red-500 hover:underline"
                  >
                    Logout
                  </button>
                ) : name !== "Instagram" ? (
                  <button
                    onClick={(e) => handleAuthenticate(e, provider)}
                    className="text-sm text-blue-500 hover:underline"
                  >
                    Connect
                  </button>
                ) : null}
                {isSelected ? <CheckCircle className="text-blue-500" /> : <RadioButtonUnchecked className="text-gray-400" />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PlatformList;
