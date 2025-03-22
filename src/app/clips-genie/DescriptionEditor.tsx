"use client";

import React, { useState } from "react";
import { usePlatformContext } from "./PlatformContext";
import axios from "axios";
import toast from "react-hot-toast";
import { useSession } from "next-auth/react";

const DescriptionEditor = () => {
  const { data: session } = useSession();
  const {
    sharedDescription, setSharedDescription,
    facebookTemplate, setFacebookTemplate,
    instagramTemplate, setInstagramTemplate,
    youtubeTemplate, setYoutubeTemplate,
    blueskyTemplate, setBlueskyTemplate,
    twitterTemplate, setTwitterTemplate,
    selectedPlatforms,
    selectedFile,
    videoTitle,
    setVideoTitle
  } = usePlatformContext();

  const [isPosting, setIsPosting] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);

  const handlePostToSelectedPlatforms = async () => {
    if (!selectedFile) {
      toast.error("No video file selected.");
      return;
    }

    if (!selectedPlatforms || selectedPlatforms.length === 0) {
      toast.error("No platforms selected.");
      return;
    }

    if (selectedPlatforms.includes("bluesky") && !selectedPlatforms.includes("google") && !youtubeUrl) {
      setShowYouTubeModal(true);
      return;
    }

    setIsPosting(true);
    const results: any[] = [];

    const descriptions: Record<string, string> = {
      facebook: `${sharedDescription}\n\n${facebookTemplate}`,
      instagram: `${sharedDescription}\n\n${instagramTemplate}`,
      google: `${sharedDescription}\n\n${youtubeTemplate}`,
      bluesky: blueskyTemplate,
      twitter: twitterTemplate,
    };

    const endpointMap: Record<string, string> = {
      bluesky: "/api/bluesky/post",
      facebook: "/api/meta/upload/facebook",
      instagram: "/api/meta/upload/instagram",
      google: "/api/youtube/upload",
      twitter: "/api/twitter/post",
    };

    let uploadedYouTubeUrl = youtubeUrl;

    // ✅ Upload to YouTube first if selected
    if (selectedPlatforms.includes("google")) {
      try {
        const ytForm = new FormData();
        ytForm.append("file", selectedFile);
        ytForm.append("title", videoTitle);
        ytForm.append("description", descriptions.google);
        ytForm.append("userId", session?.user.id!);

        const ytRes = await axios.post(endpointMap.google, ytForm, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        uploadedYouTubeUrl = ytRes.data.youtubeLink;
        results.push({ platform: "youtube", success: true });
      } catch (err: any) {
        results.push({ platform: "youtube", success: false, error: err.response?.data || err.message });
        toast.error("YouTube upload failed. Skipping Bluesky.");
        // Remove Bluesky from selectedPlatforms if YouTube failed
        return setIsPosting(false);
      }
    }

    // ✅ Post to other platforms
    for (const platform of selectedPlatforms) {
      if (platform === "google") continue;

      try {
        if (!endpointMap[platform]) {
          results.push({ platform, success: false, error: "Unknown platform" });
          continue;
        }

        if (platform === "facebook" || platform === "instagram") {
          const form = new FormData();
          form.append("file", selectedFile);
          form.append("description", descriptions[platform]);
          // form.append("accessToken", session?.user.facebookAccessToken || "");
          form.append("userId", session?.user.id!);

          await axios.post(endpointMap[platform], form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        } else {
          // post to bluesky
          await axios.post(endpointMap[platform], {
            youtubeUrl: uploadedYouTubeUrl,
            description: descriptions[platform],
            userId: session?.user.id,
          });
        }

        results.push({ platform, success: true });
      } catch (err: any) {
        results.push({ platform, success: false, error: err.response?.data || err.message });
      }
    }

    console.log("✅ Post Results:", results);
    toast.success("Posting completed!");

    setIsPosting(false);
  };


  return (
    <div>
      <label className="block mt-4 mb-2 text-sm font-medium">Video Title</label>
      <input
        type="text"
        value={videoTitle}
        onChange={(e) => setVideoTitle(e.target.value)}
        className="w-full p-2 border rounded"
      />

      <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
      <textarea
        value={sharedDescription}
        onChange={(e) => setSharedDescription(e.target.value)}
        className="w-full p-2 border rounded h-32 resize-none"
      />

      {[
        { label: "Facebook", state: facebookTemplate, setState: setFacebookTemplate },
        { label: "Instagram", state: instagramTemplate, setState: setInstagramTemplate },
        { label: "YouTube", state: youtubeTemplate, setState: setYoutubeTemplate },
        { label: "Bluesky", state: blueskyTemplate, setState: setBlueskyTemplate },
        { label: "Twitter", state: twitterTemplate, setState: setTwitterTemplate }
      ].map(({ label, state, setState }) => (
        <div key={label} className="mt-4">
          <label className="block mb-2 text-sm font-medium">{label}</label>
          <textarea
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full p-2 border rounded h-24 resize-none dark:text-black"
          />
        </div>
      ))}

      <div className="flex justify-end items-center gap-4 mt-6">
        <button
          className="bg-gray-300 text-black dark:bg-gray-700 dark:text-white px-4 py-2 rounded-md hover:bg-gray-600 dark:hover:bg-gray-600 transition"
          onClick={() => toast("Editing canceled.")}
        >
          ✖ Cancel
        </button>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
          onClick={handlePostToSelectedPlatforms}
          disabled={isPosting}
        >
          {isPosting ? "Posting..." : "Post to Selected Platforms"}
        </button>
      </div>

      {showYouTubeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-md shadow-md max-w-md w-full">
            <h2 className="text-lg font-semibold mb-2">YouTube URL Required</h2>
            <p className="text-sm text-gray-500 mb-4">
              You need to provide a YouTube URL for posting on Bluesky.
            </p>
            <input
              type="text"
              placeholder="Enter YouTube URL..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full p-2 border rounded mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 transition"
                onClick={() => setShowYouTubeModal(false)}
              >
                Cancel
              </button>
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
                onClick={() => {
                  setShowYouTubeModal(false);
                  handlePostToSelectedPlatforms();
                }}
                disabled={!youtubeUrl}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DescriptionEditor;
