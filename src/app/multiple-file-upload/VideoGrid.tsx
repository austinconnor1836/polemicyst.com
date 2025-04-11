"use client";

import React from "react";
import { usePlatformContext } from "./PlatformContext";

const VideoGrid = () => {
  const { selectedVideos, setSelectedVideos, setActiveVideoIndex } = usePlatformContext();

  if (!selectedVideos?.length) {
    return <p className="text-center text-gray-500 mt-8">No videos uploaded yet.</p>;
  }

  const handleSelectAll = () => {
    const allSelected = selectedVideos.every((v) => v.selected);
    const updated = selectedVideos.map((video) => ({
      ...video,
      selected: !allSelected, // Toggle all
    }));
    setSelectedVideos(updated);
  };

  return (
    <div className="mt-10">
      <div className="flex justify-end mb-2">
        <button
          onClick={handleSelectAll}
          className="text-sm text-blue-600 hover:underline"
        >
          Select All
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {selectedVideos.map((video, index) => (
          <div
            key={index}
            className="relative border rounded-lg p-4 shadow-sm bg-white dark:bg-gray-800"
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              className="absolute top-2 right-2"
              checked={!!video.selected}
              onChange={(e) => {
                const updated = [...selectedVideos];
                updated[index].selected = e.target.checked;
                setSelectedVideos(updated);
              }}
              onClick={(e) => e.stopPropagation()}
            />

            {/* Clickable area for modal */}
            <div
              onClick={() => setActiveVideoIndex(index)}
              className="cursor-pointer"
            >
              <h3 className="font-semibold text-sm truncate mb-2">{video.title}</h3>
              <video
                src={video.videoPreview || ""}
                controls
                className="w-full rounded max-h-48"
              />
              {video.isGenerating ? (
                <p className="text-sm text-gray-500 mt-2">Generating description...</p>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                  {video.sharedDescription}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoGrid;
