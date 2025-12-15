"use client";

import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { usePlatformContext } from "./PlatformContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
      <Label className="block pb-2 pt-8 text-sm font-medium">Upload Video File</Label>
      <div className="border-2 border-dashed border-gray-400 p-6 text-center rounded-lg cursor-pointer">
        <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" id="fileUpload" />
        <Button asChild className="mt-2 cursor-pointer">
          <label htmlFor="fileUpload">Choose from device</label>
        </Button>
        {selectedFile && <p className="text-xs text-gray-500 mt-2">{selectedFile.name}</p>}
        {videoPreview && <video className="mt-4 w-full max-h-40" controls><source src={videoPreview} type="video/mp4" /></video>}
        {isGenerating && <p className="text-sm text-gray-500 mt-2">Generating title and description...</p>}
      </div>
    </div>
  );
};

export default VideoUpload;
