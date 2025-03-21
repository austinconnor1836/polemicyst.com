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
    setVideoTitle
  } = usePlatformContext();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setVideoPreview(URL.createObjectURL(file));
      await generateDescription(file);
    }
  };

  return (
    <div>
      <label className="block mb-2 text-sm font-medium">Upload Video File</label>
      <div className="border-2 border-dashed border-gray-400 p-6 text-center rounded-lg cursor-pointer">
        <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" id="fileUpload" />
        <label htmlFor="fileUpload" className="block mt-2 bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700">
          Choose from device
        </label>
        {selectedFile && <p className="text-xs text-gray-500 mt-2">{selectedFile.name}</p>}
        {videoPreview && <video className="mt-4 w-full max-h-40" controls><source src={videoPreview} type="video/mp4" /></video>}
        {isGenerating && <p className="text-sm text-gray-500 mt-2">Generating title and description...</p>}
      </div>
    </div>
  );
};

export default VideoUpload;
