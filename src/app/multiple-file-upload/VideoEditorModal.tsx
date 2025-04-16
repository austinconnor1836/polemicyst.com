"use client";

import React from "react";
import { usePlatformContext } from "./PlatformContext";

const VideoEditorModal = () => {
  const { activeVideo, setActiveVideo } = usePlatformContext();

  if (!activeVideo) return null;

  const updateField = (field: keyof typeof activeVideo, value: string) => {
    setActiveVideo({ ...activeVideo, [field]: value });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="relative bg-white dark:bg-gray-900 p-6 rounded-lg w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        <button
          className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-600"
          onClick={() => setActiveVideo(null)}
        >
          ✖ Close
        </button>

        <h2 className="text-xl font-semibold mb-4 pr-32">Edit Video: {activeVideo.videoTitle}</h2>

        <label className="block mb-2 text-sm font-medium">Video Title</label>
        <input
          type="text"
          value={activeVideo.videoTitle}
          onChange={(e) => updateField("videoTitle", e.target.value)}
          className="w-full p-2 border rounded dark:text-black"
        />

        <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
        <textarea
          value={activeVideo.sharedDescription}
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
              value={(activeVideo as any)[key] || ""}
              onChange={(e) => updateField(key as keyof typeof activeVideo, e.target.value)}
              className="w-full p-2 border rounded h-24 resize-none dark:text-black"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoEditorModal;
