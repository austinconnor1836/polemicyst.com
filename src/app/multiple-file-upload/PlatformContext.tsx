"use client";

import { Video } from "@prisma/client";
import { useSession } from "next-auth/react";
import React, { createContext, useState, useContext, useEffect, useRef } from "react";
import toast from "react-hot-toast";

export type UploadedVideo = {
  id: string;
  videoTitle: string;
  sharedDescription: string;
  facebookTemplate: string;
  instagramTemplate: string;
  youtubeTemplate: string;
  blueskyTemplate: string;
  twitterTemplate: string;
};

interface PlatformContextProps {
  uploadedVideos: UploadedVideo[];
  setUploadedVideos: React.Dispatch<React.SetStateAction<UploadedVideo[]>>;
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
  generateDescription: (videoId: string) => Promise<void>;
  regenerateDescription: (videoId: string) => Promise<void>;
  refreshGridToggle: boolean;
  triggerGridRefresh: () => void;
  showTemplateModal: boolean;
  setShowTemplateModal: React.Dispatch<React.SetStateAction<boolean>>;
  getFileFromCache: (videoId: string) => File | undefined;
  setFileInCache: (videoId: string, file: File) => void;
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

  const [facebookTemplate, setFacebookTemplate] = useState("...");
  const [instagramTemplate, setInstagramTemplate] = useState("...");
  const [youtubeTemplate, setYoutubeTemplate] = useState("...");
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
  const [refreshGridToggle, setRefreshGridToggle] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [uploadedVideos, setUploadedVideos] = useState<UploadedVideo[]>([]);

  const videoFileCache = useRef<Map<string, File>>(new Map());
  const getFileFromCache = (videoId: string) => videoFileCache.current.get(videoId);
  const setFileInCache = (videoId: string, file: File) => videoFileCache.current.set(videoId, file);

  const triggerGridRefresh = () => setRefreshGridToggle(prev => !prev);

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

  const generateDescription = async (videoId: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/generateDescription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      const updated = await response.json();

      setActiveVideo((prev) =>
        prev
          ? {
              ...prev,
              videoTitle: updated.title,
              sharedDescription: updated.fullDescription,
              blueskyTemplate: updated.shortTemplate,
              twitterTemplate: updated.shortTemplate,
              facebookTemplate: prev.facebookTemplate,
              instagramTemplate: prev.instagramTemplate,
              youtubeTemplate: prev.youtubeTemplate,
            }
          : null
      );
    } catch (error) {
      console.error("❌ Error generating description:", error);
      toast.error("Failed to generate description.");
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateDescription = async (videoId: string) => {
    await generateDescription(videoId);
    triggerGridRefresh();
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
        regenerateDescription,
        refreshGridToggle,
        triggerGridRefresh,
        showTemplateModal,
        setShowTemplateModal,
        getFileFromCache,
        setFileInCache,
        uploadedVideos,
        setUploadedVideos
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