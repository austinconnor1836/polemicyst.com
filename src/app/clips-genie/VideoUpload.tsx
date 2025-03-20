"use client";

import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { usePlatformContext } from "./PlatformContext";

const VideoUpload = () => {
  const {
    selectedFile,
    setSelectedFile,
    videoPreview,
    setVideoPreview,
    setBlueskyTemplate,
    setTwitterTemplate,
    setSharedDescription
  } = usePlatformContext();
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  const generateDescription = async (file: File) => {
    setIsGeneratingDescription(true);
    setSharedDescription("Generating description...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await axios.post("/api/generateDescription", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      console.log("response.data", response.data);
      const { description, hashtags } = response.data;

      if (description && hashtags) {
        const fixedHashtags = [
          "#Polemicyst",
          "#news",
          "#politics",
          "#youtube",
          "#trump",
          "#left",
          "#progressive",
          "#viral",
          "#maga",
        ];

        const allHashtags = [...fixedHashtags, ...hashtags];
        const hashtagsString = allHashtags.join(", ");
        const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";
        const finalDescription = `${description}\n\n${hashtagsString}${patreonLink}`;

        setSharedDescription(finalDescription);

        const maxLength = 300;
        const trimmedDescription = `${description} ${hashtagsString}`.substring(0, maxLength).trim();

        setBlueskyTemplate(trimmedDescription);
        setTwitterTemplate(trimmedDescription);
      } else {
        setSharedDescription("Failed to generate description.");
        setBlueskyTemplate("Failed to generate description.");
        setTwitterTemplate("Failed to generate description.");
      }
    } catch (error) {
      console.error("Error generating description:", error);
      toast.error("Failed to generate description.");
      setSharedDescription("Failed to generate description.");
      setBlueskyTemplate("Failed to generate description.");
      setTwitterTemplate("Failed to generate description.");
    } finally {
      setIsGeneratingDescription(false);
    }
  };

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
        {isGeneratingDescription && <p className="text-sm text-gray-500 mt-2">Generating description...</p>}
      </div>
    </div>
  );
};

export default VideoUpload;
