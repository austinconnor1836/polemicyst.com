"use client";

import React, { useState } from "react";
import { usePlatformContext } from "./PlatformContext";
import { useSession } from "next-auth/react";
import axios from "axios";
import toast from "react-hot-toast";

const PublishSelectedButton = () => {
  const {
    selectedVideos,
    selectedPlatforms,
    isAuthenticated,
    setIsPosting,
  } = usePlatformContext();
  const { data: session } = useSession();

  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    const videosToPublish = selectedVideos.filter((video) => video.selected);

    if (!videosToPublish.length) {
      toast.error("No videos selected for publishing.");
      return;
    }

    if (!selectedPlatforms.length) {
      toast.error("No platforms selected.");
      return;
    }

    if (!session?.user?.id) {
      toast.error("User not authenticated.");
      return;
    }

    setIsPublishing(true);
    setIsPosting(true);

    for (const video of videosToPublish) {
      const descriptions: Record<string, string> = {
        facebook: `${video.sharedDescription}\n\n${video.facebookTemplate}`,
        instagram: `${video.sharedDescription}\n\n${video.instagramTemplate}`,
        google: `${video.sharedDescription}\n\n${video.youtubeTemplate}`,
        bluesky: video.blueskyTemplate,
        twitter: video.twitterTemplate,
      };

      const endpointMap: Record<string, string> = {
        facebook: "/api/meta/upload/facebook",
        instagram: "/api/meta/upload/instagram",
        google: "/api/youtube/upload",
        bluesky: "/api/bluesky/post",
        twitter: "/api/twitter/post",
      };

      let uploadedYouTubeUrl = "";

      if (selectedPlatforms.includes("google")) {
        try {
          const ytForm = new FormData();
          ytForm.append("file", video.file);
          ytForm.append("title", video.title);
          ytForm.append("description", descriptions.google);
          ytForm.append("userId", session.user.id);

          const ytRes = await axios.post(endpointMap.google, ytForm, {
            headers: { "Content-Type": "multipart/form-data" },
          });

          uploadedYouTubeUrl = ytRes.data.youtubeLink;
        } catch (err: any) {
          toast.error(`YouTube upload failed for ${video.title}. Skipping Bluesky.`);
          continue;
        }
      }

      for (const platform of selectedPlatforms) {
        if (!endpointMap[platform]) continue;
        try {
          if (platform === "facebook" || platform === "instagram") {
            const form = new FormData();
            form.append("file", video.file);
            form.append("description", descriptions[platform]);
            form.append("userId", session.user.id);

            await axios.post(endpointMap[platform], form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } else {
            await axios.post(endpointMap[platform], {
              youtubeUrl: uploadedYouTubeUrl,
              description: descriptions[platform],
              userId: session.user.id,
            });
          }
        } catch (err: any) {
          toast.error(`${platform} post failed for ${video.title}`);
        }
      }
    }

    setIsPublishing(false);
    setIsPosting(false);
    toast.success("Publishing completed.");
  };

  return (
    <button
      onClick={handlePublish}
      disabled={isPublishing}
      className="mt-8 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
    >
      {isPublishing ? "Publishing..." : "Publish Selected"}
    </button>
  );
};

export default PublishSelectedButton;
