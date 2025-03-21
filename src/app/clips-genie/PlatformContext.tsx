"use client";

import { useSession } from "next-auth/react";
import React, { createContext, useState, useContext, useEffect } from "react";
import toast from 'react-hot-toast';
import axios from 'axios';

interface PlatformContextProps {
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  videoPreview: string | null;
  setVideoPreview: (preview: string | null) => void;
  description: string;
  setDescription: (desc: string) => void;
  facebookTemplate: string;
  setFacebookTemplate: (desc: string) => void;
  instagramTemplate: string;
  setInstagramTemplate: (desc: string) => void;
  youtubeTemplate: string;
  setYoutubeTemplate: (desc: string) => void;
  blueskyTemplate: string;
  setBlueskyTemplate: (desc: string) => void;
  twitterTemplate: string;
  setTwitterTemplate: (desc: string) => void;
  selectedPlatforms: string[];
  setSelectedPlatforms: React.Dispatch<React.SetStateAction<string[]>>;
  togglePlatform: (provider: string) => void;
  isAuthenticated: Record<string, boolean>;
  isPosting: boolean;
  setIsPosting: (isPosting: boolean) => void;
  authenticate: (provider: string) => void;
  refreshAuthStatus: () => void;
  sharedDescription: string;
  setSharedDescription: (desc: string) => void;
  videoTitle: string;
  setVideoTitle: (title: string) => void;
  isGenerating: boolean;
  setIsGenerating: (isGenerating: boolean) => void;
  generateDescription: (file: File) => void;
}

const PlatformContext = createContext<PlatformContextProps | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session, status } = useSession();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [sharedDescription, setSharedDescription] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [facebookTemplate, setFacebookTemplate] = useState(
    `For more from Polemicyst:\n
Youtube: https://www.youtube.com/@Polemicyst
Twitter: https://x.com/Polemicyst
Instagram: https://www.instagram.com/polemicyst/
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );

  const [instagramTemplate, setInstagramTemplate] = useState(
    `For more from Polemicyst:\n
Youtube: https://www.youtube.com/@Polemicyst
Twitter: https://x.com/Polemicyst
Facebook: https://www.facebook.com/profile.php?id=61573192766929
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );
  const [youtubeTemplate, setYoutubeTemplate] = useState(
    `For more from Polemicyst:\n
Twitter: https://x.com/Polemicyst
Instagram: https://www.instagram.com/polemicyst/
Facebook: https://www.facebook.com/profile.php?id=61573192766929
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );
  const [blueskyTemplate, setBlueskyTemplate] = useState("");
  const [twitterTemplate, setTwitterTemplate] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<Record<string, boolean>>({
    facebook: false,
    instagram: false,
    google: false,
    bluesky: false,
    twitter: false,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  // Function to fetch authentication status from the API
  const fetchAuthenticationStatus = async () => {
    if (!session?.user?.id) return;

    try {
      const res = await fetch(`/api/auth/status`);
      const data = await res.json();

      setIsAuthenticated(data.isAuthenticated || {});
    } catch (error) {
      console.error("Error fetching authentication status:", error);
    }
  };

  // Refresh authentication status when the session updates
  useEffect(() => {
    if (status === "authenticated") {
      fetchAuthenticationStatus();
    }
  }, [session, status]);

  // Toggle platform selection
  const togglePlatform = (provider: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  // Mark a platform as authenticated
  const authenticate = (provider: string) => {
    setIsAuthenticated((prev) => ({
      ...prev,
      [provider]: true,
    }));
  };

  const generateDescription = async (file: File) => {
    setIsGenerating(true);
    setSharedDescription("Generating description...");
    setVideoTitle("Generating video title...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await axios.post("/api/generateDescription", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const { description, hashtags, title } = response.data;

      if (description && hashtags) {
        const fixedHashtags = [
          "#Polemicyst",
          "#news",
          "#politics",
          "#youtube",
          "#trump",
          "#left",
          "#progressive",
          "#viral",
          "#maga",
        ];

        const allHashtags = [...fixedHashtags, ...hashtags];
        const hashtagsString = allHashtags.join(", ");
        const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";
        const finalDescription = `${description}\n\n${hashtagsString}${patreonLink}`;

        setSharedDescription(finalDescription);
        setVideoTitle(title);

        const maxLength = 300;
        const trimmedDescription = `${description} ${hashtagsString}`.substring(0, maxLength).trim();

        setBlueskyTemplate(trimmedDescription);
        setTwitterTemplate(trimmedDescription);
      } else {
        setSharedDescription("Failed to generate description.");
        setVideoTitle("Failed to generate title.");
        setBlueskyTemplate("Failed to generate description.");
        setTwitterTemplate("Failed to generate description.");
      }
    } catch (error) {
      console.error("Error generating description:", error);
      toast.error("Failed to generate description.");
      setSharedDescription("Failed to generate description.");
      setVideoTitle("Failed to generate title.");
      setBlueskyTemplate("Failed to generate description.");
      setTwitterTemplate("Failed to generate description.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <PlatformContext.Provider
      value={{
        selectedFile,
        setSelectedFile,
        videoPreview,
        setVideoPreview,
        description,
        setDescription,
        facebookTemplate,
        setFacebookTemplate,
        instagramTemplate,
        setInstagramTemplate,
        youtubeTemplate,
        setYoutubeTemplate,
        blueskyTemplate,
        setBlueskyTemplate,
        twitterTemplate,
        setTwitterTemplate,
        selectedPlatforms,
        setSelectedPlatforms,
        togglePlatform,
        isAuthenticated,
        authenticate,
        refreshAuthStatus: fetchAuthenticationStatus,
        sharedDescription,
        setSharedDescription,
        isPosting,
        setIsPosting,
        videoTitle,
        setVideoTitle,
        isGenerating,
        setIsGenerating,
        generateDescription
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
};

export const usePlatformContext = () => {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error("usePlatformContext must be used within a PlatformProvider");
  }
  return context;
};
