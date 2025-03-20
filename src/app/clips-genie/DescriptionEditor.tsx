"use client";

import React, { useState } from "react";
import { usePlatformContext } from "./PlatformContext";
import axios from "axios";
import toast from "react-hot-toast";

const DescriptionEditor = () => {
  const {
    sharedDescription, setSharedDescription,
    facebookTemplate, setFacebookTemplate,
    instagramTemplate, setInstagramTemplate,
    youtubeTemplate, setYoutubeTemplate,
    blueskyTemplate, setBlueskyTemplate,
    twitterTemplate, setTwitterTemplate,
    selectedPlatforms,
  } = usePlatformContext();

  const [isPosting, setIsPosting] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);

  // ✅ Get the correct description template for each platform
  const getPlatformTemplate = (platform: string): string => {
    switch (platform) {
      case "facebook":
        return `${sharedDescription}\n\n${facebookTemplate}`;
      case "instagram":
        return `${sharedDescription}\n\n${instagramTemplate}`;
      case "youtube":
        return `${sharedDescription}\n\n${youtubeTemplate}`;
      case "bluesky":
      case "twitter":
        return `${blueskyTemplate}`; // Bluesky & Twitter only get their specific template
      default:
        return "";
    }
  };

  // ✅ Handle post submission
  const handlePostToSelectedPlatforms = async () => {
    // Check if Bluesky is selected without YouTube
    if (selectedPlatforms.includes("bluesky") && !selectedPlatforms.includes("youtube") && !youtubeUrl) {
      setShowYouTubeModal(true);
      return;
    }

    setIsPosting(true);
    try {
      const response = await axios.post("/api/postToPlatforms", {
        platforms: selectedPlatforms,
        descriptions: selectedPlatforms.reduce((acc, platform) => {
          acc[platform] = getPlatformTemplate(platform);
          return acc;
        }, {} as Record<string, string>),
        videoUrl: youtubeUrl, // Use the provided YouTube URL if required
      });

      toast.success("Posted successfully!");
      console.log("✅ Posting result:", response.data);
    } catch (error) {
      console.error("❌ Posting error:", error);
      toast.error("Failed to post.");
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div>
      <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
      <textarea 
        value={sharedDescription} 
        onChange={(e) => setSharedDescription(e.target.value)} 
        className="w-full p-2 border rounded h-32 resize-none"
      ></textarea>

      {[
        { label: "Facebook", state: facebookTemplate, setState: setFacebookTemplate },
        { label: "Instagram", state: instagramTemplate, setState: setInstagramTemplate },
        { label: "YouTube", state: youtubeTemplate, setState: setYoutubeTemplate },
        { label: "Bluesky", state: blueskyTemplate, setState: setBlueskyTemplate },
        { label: "Twitter", state: twitterTemplate, setState: setTwitterTemplate },
      ].map(({ label, state, setState }) => (
        <div key={label} className="mt-4">
          <label className="block mb-2 text-sm font-medium">{label}</label>
          <textarea
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full p-2 border rounded h-24 resize-none"
          ></textarea>
        </div>
      ))}

      {/* ✅ Action Buttons */}
      <div className="flex justify-between items-center mt-6">
        <button 
          className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition"
          onClick={() => toast("Editing canceled.")}
        >
          ✖ Cancel
        </button>
        <button 
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          onClick={handlePostToSelectedPlatforms}
          disabled={isPosting}
        >
          {isPosting ? "Posting..." : "Post to Selected Platforms"}
        </button>
      </div>

      {/* ✅ YouTube URL Modal */}
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
