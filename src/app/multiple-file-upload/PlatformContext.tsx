"use client";

import { Video } from "@prisma/client";
import { useSession } from "next-auth/react";
import React, { createContext, useState, useContext, useEffect } from "react";
import toast from "react-hot-toast";

interface PlatformContextProps {
  activeVideo: Video | null;
  setActiveVideo: React.Dispatch<React.SetStateAction<Video | null>>;
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
  generateDescription: (file: File) => Promise<void>;
}

const PlatformContext = createContext<PlatformContextProps | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session, status } = useSession();
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
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

  const fetchAuthenticationStatus = async () => {
    if (!session?.user?.id) return;
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated || {});
    } catch (error) {
      console.error("Error fetching authentication status:", error);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchAuthenticationStatus();
    }
  }, [session, status]);

  const togglePlatform = (provider: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  const authenticate = (provider: string) => {
    setIsAuthenticated((prev) => ({ ...prev, [provider]: true }));
  };

  const generateDescription = async (file: File) => {
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/generateDescription", {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      const { description, hashtags, title } = parsed;

      const fixedHashtags = [
        "#Polemicyst", "#news", "#politics", "#youtube", "#trump",
        "#left", "#progressive", "#viral", "#maga",
      ];
      const allHashtags = [...fixedHashtags, ...hashtags];
      const hashtagsString = allHashtags.join(", ");
      const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";

      setVideoTitle(title || "Generated title");
      setSharedDescription(`${description}\n\n${hashtagsString}${patreonLink}`);
      const short = `${description} ${hashtagsString}`.substring(0, 300).trim();
      setBlueskyTemplate(short);
      setTwitterTemplate(short);
    } catch (error) {
      console.error("❌ Error generating description:", error);
      toast.error("Failed to generate description.");
      setVideoTitle("Failed to generate title");
      setSharedDescription("Failed to generate description.");
      setBlueskyTemplate("Failed to generate description.");
      setTwitterTemplate("Failed to generate description.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <PlatformContext.Provider
      value={{
        activeVideo,
        setActiveVideo,
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
        generateDescription,
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
