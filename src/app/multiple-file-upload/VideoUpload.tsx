"use client";

import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { usePlatformContext } from "./PlatformContext";

const VideoUpload = () => {
  const {
    generateDescription,
    isGenerating,
    setIsGenerating,
    selectedFile,
    setSelectedFile,
    videoPreview,
    setVideoPreview,
    setBlueskyTemplate,
    setTwitterTemplate,
    setSharedDescription,
    setVideoTitle,
    selectedVideos,
    setSelectedVideos,
    facebookTemplate,
    instagramTemplate,
    youtubeTemplate,
    setPendingGenerationIndexes
  } = usePlatformContext();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles = Array.from(files);

    const newVideoEntries = await Promise.all(
      newFiles.map(async (file) => {
        const preview = URL.createObjectURL(file);

        const video = {
          file,
          videoPreview: preview,
          title: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
          sharedDescription: "",
          facebookTemplate,
          instagramTemplate,
          youtubeTemplate,
          blueskyTemplate: "",
          twitterTemplate: "",
          isGenerating: true,
          selected: false
        };

        return video;
      })
    );

    // Add to selectedVideos state first, so we can show spinners
    setSelectedVideos((prev) => {
      const updated = [...prev, ...newVideoEntries];
      const newIndexes = newVideoEntries.map((_, idx) => prev.length + idx);

      // queue background generation
      setPendingGenerationIndexes((prev) => [...prev, ...newIndexes]);

      return updated;
    });


  };


  return (
    <div>
      <label className="block mb-2 text-sm font-medium pt-8">Upload Video Files</label>
      <div className="border-2 border-dashed border-gray-400 p-6 text-center rounded-lg cursor-pointer">
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id="fileUpload"
        />
        <label
          htmlFor="fileUpload"
          className="block mt-2 bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700"
        >
          Choose from device
        </label>
        {selectedVideos?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
            {selectedVideos.map((video, index) => (
              <div key={index} className="border rounded p-2">
                <p className="text-xs text-gray-600 truncate">{video.title}</p>
                <video className="mt-2 w-full max-h-40" controls>
                  <source src={video.videoPreview || ""} type="video/mp4" />
                </video>
                {video.isGenerating && (
                  <p className="text-sm text-gray-500 mt-1">Generating description...</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoUpload;
