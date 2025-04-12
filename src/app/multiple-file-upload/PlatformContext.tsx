"use client";

import { useSession } from "next-auth/react";
import React, { createContext, useState, useContext, useEffect } from "react";
import toast from 'react-hot-toast';
import axios from 'axios';

interface VideoData {
  file: File;
  videoPreview: string | null;
  title: string;
  sharedDescription: string;
  facebookTemplate: string;
  instagramTemplate: string;
  youtubeTemplate: string;
  blueskyTemplate: string;
  twitterTemplate: string;
  isGenerating: boolean;
  selected: boolean;
}

interface PlatformContextProps {
  activeVideoIndex: number | null;
  setActiveVideoIndex: React.Dispatch<React.SetStateAction<number | null>>;
  selectedVideos: VideoData[];
  setSelectedVideos: React.Dispatch<React.SetStateAction<VideoData[]>>;
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
  generateDescription: (index: number) => void;
  setPendingGenerationIndexes: React.Dispatch<React.SetStateAction<number[]>>;
}

const PlatformContext = createContext<PlatformContextProps | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session, status } = useSession();
  const [activeVideoIndex, setActiveVideoIndex] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedVideos, setSelectedVideos] = useState<VideoData[]>([]);
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
  const [pendingGenerationIndexes, setPendingGenerationIndexes] = useState<number[]>([]);

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

  useEffect(() => {
    if (pendingGenerationIndexes.length === 0) return;

    pendingGenerationIndexes.forEach((index) => {
      generateDescription(index);
    });

    setPendingGenerationIndexes([]); // reset after processing
  }, [pendingGenerationIndexes]);


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

  const generateDescription = async (index: number) => {
    setSelectedVideos(prev => {
      const updated = [...prev];
      const video = updated[index];
      if (!video) return prev;

      console.log("🔁 Generating description for index:", index, video.title);

      video.isGenerating = true;
      video.sharedDescription = "Generating description...";
      video.title = "Generating video title...";
      return updated;
    });

    try {
      const currentVideo = selectedVideos[index]; // still fine for reading `file`
      const formData = new FormData();
      formData.append("file", currentVideo.file);

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
        "#left", "#progressive", "#viral", "#maga"
      ];
      const allHashtags = [...fixedHashtags, ...hashtags];
      const hashtagsString = allHashtags.join(", ");
      const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";
      const finalDescription = `${description}\n\n${hashtagsString}${patreonLink}`;
      const trimmed = `${description} ${hashtagsString}`.substring(0, 300).trim();

      setSelectedVideos(prev => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          title: title || updated[index].title,
          sharedDescription: finalDescription,
          blueskyTemplate: trimmed,
          twitterTemplate: trimmed,
          isGenerating: false,
        };
        return updated;
      });
    } catch (error) {
      console.error("❌ Error generating description:", error);
      toast.error("Failed to generate description.");

      setSelectedVideos(prev => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          title: "Failed to generate title",
          sharedDescription: "Failed to generate description.",
          blueskyTemplate: "Failed to generate description.",
          twitterTemplate: "Failed to generate description.",
          isGenerating: false,
        };
        return updated;
      });
    }
  };



  return (
    <PlatformContext.Provider
      value={{
        activeVideoIndex,
        setActiveVideoIndex,
        selectedVideos,
        setSelectedVideos,
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
        setPendingGenerationIndexes
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
