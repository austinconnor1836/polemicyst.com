"use client";

import React, { useState } from "react";
import { usePlatformContext } from "./PlatformContext";
import toast from "react-hot-toast";

const DescriptionEditor = () => {
  const {
    selectedVideos,
    setSelectedVideos,
    generateDescription,
  } = usePlatformContext();

  const [activeVideoIndex, setActiveVideoIndex] = useState<number | null>(null);

  const handleInputChange = (index: number, field: keyof (typeof selectedVideos)[0], value: string) => {
    const updated = [...selectedVideos];
    updated[index][field] = value;
    setSelectedVideos(updated);
  };

  return (
    <div>

      {/* Modal for editing */}
      {activeVideoIndex !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-md shadow-lg max-w-2xl w-full overflow-y-auto max-h-[90vh]">
            <h2 className="text-lg font-semibold mb-2">Editing Video {activeVideoIndex + 1}</h2>

            <label className="block mt-4 mb-2 text-sm font-medium">Video Title</label>
            <input
              type="text"
              value={selectedVideos[activeVideoIndex].title}
              onChange={(e) => handleInputChange(activeVideoIndex, "title", e.target.value)}
              className="w-full p-2 border rounded dark:text-black"
            />

            <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
            <textarea
              value={selectedVideos[activeVideoIndex].sharedDescription}
              onChange={(e) => handleInputChange(activeVideoIndex, "sharedDescription", e.target.value)}
              className="w-full p-2 border rounded h-32 resize-none dark:text-black"
            />

            {([
              "facebookTemplate",
              "instagramTemplate",
              "youtubeTemplate",
              "blueskyTemplate",
              "twitterTemplate"
            ] as const).map((key) => (
              <div key={key} className="mt-4">
                <label className="block mb-2 text-sm font-medium capitalize">{key.replace("Template", "")}</label>
                <textarea
                  value={selectedVideos[activeVideoIndex][key]}
                  onChange={(e) =>
                    handleInputChange(
                      activeVideoIndex,
                      key,
                      e.target.value
                    )
                  }
                  className="w-full p-2 border rounded h-24 resize-none dark:text-black"
                />
              </div>
            ))}

            <div className="flex justify-end gap-4 mt-6">
              <button
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                onClick={() => setActiveVideoIndex(null)}
              >
                Cancel
              </button>
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                onClick={() => generateDescription(activeVideoIndex)}
                disabled={selectedVideos[activeVideoIndex].isGenerating}
              >
                {selectedVideos[activeVideoIndex].isGenerating ? "Generating..." : "Regenerate AI Description"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DescriptionEditor;
