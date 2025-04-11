"use client";

import React, { useEffect } from "react";
import { usePlatformContext } from "./PlatformContext";

const VideoEditorModal = () => {
  const {
    selectedVideos,
    setSelectedVideos,
    activeVideoIndex,
    setActiveVideoIndex,
    facebookTemplate,
    instagramTemplate,
    youtubeTemplate,
    blueskyTemplate,
    twitterTemplate,
    isGenerating,
    generateDescription,
  } = usePlatformContext();

  if (activeVideoIndex === null) return null;

  const video = selectedVideos[activeVideoIndex];

  const updateField = (field: keyof typeof video, value: string) => {
    const updated = [...selectedVideos];
    updated[activeVideoIndex] = { ...video, [field]: value };
    setSelectedVideos(updated);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="relative bg-white dark:bg-gray-900 p-6 rounded-lg w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">

        {/* ✅ Regenerate AI Button positioned in the top-right */}
        <button
          className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          onClick={() => generateDescription(activeVideoIndex)}
          disabled={isGenerating}
        >
          {isGenerating ? "Generating..." : "Regenerate AI Description"}
        </button>

        <h2 className="text-xl font-semibold mb-4 pr-32">Edit Video: {video.title}</h2>

        <label className="block mb-2 text-sm font-medium">Video Title</label>
        <input
          type="text"
          value={video.title}
          onChange={(e) => updateField("title", e.target.value)}
          className="w-full p-2 border rounded dark:text-black"
        />

        <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
        <textarea
          value={video.sharedDescription}
          onChange={(e) => updateField("sharedDescription", e.target.value)}
          className="w-full p-2 border rounded h-32 resize-none dark:text-black"
        />

        {[ 
          { key: "facebookTemplate", label: "Facebook" },
          { key: "instagramTemplate", label: "Instagram" },
          { key: "youtubeTemplate", label: "YouTube" },
          { key: "blueskyTemplate", label: "Bluesky" },
          { key: "twitterTemplate", label: "Twitter" },
        ].map(({ key, label }) => (
          <div key={key} className="mt-4">
            <label className="block mb-2 text-sm font-medium">{label}</label>
            <textarea
              value={video[key as keyof typeof video] || ""}
              onChange={(e) =>
                updateField(key as keyof typeof video, e.target.value)
              }
              className="w-full p-2 border rounded h-24 resize-none dark:text-black"
            />
          </div>
        ))}

        <div className="flex justify-end items-center gap-4 mt-6">
          <button
            className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
            onClick={() => setActiveVideoIndex(null)}
          >
            ✖ Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoEditorModal;
