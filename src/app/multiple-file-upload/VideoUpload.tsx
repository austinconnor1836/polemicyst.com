"use client";

import React from "react";
import toast from "react-hot-toast";
import { usePlatformContext } from "./PlatformContext";

const VideoUpload = () => {
  const { regenerateDescription, triggerGridRefresh } = usePlatformContext();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles = Array.from(files);

    await Promise.all(
      newFiles.map(async (file) => {
        const title = file.name.replace(/\.[^/.]+$/, "");

        try {
          // 🔽 Construct form data for file and metadata
          const formData = new FormData();
          formData.append("file", file);
          formData.append("fileName", file.name);
          formData.append("videoTitle", title);
          formData.append("sharedDescription", "");
          formData.append("facebookTemplate", "");
          formData.append("instagramTemplate", "");
          formData.append("youtubeTemplate", "");
          formData.append("blueskyTemplate", "");
          formData.append("twitterTemplate", "");

          const saveRes = await fetch("/api/saveVideo", {
            method: "POST",
            body: formData,
          });

          const { videoId } = await saveRes.json();
          if (!videoId) throw new Error("Missing video ID");

          await regenerateDescription(videoId, file);
        } catch (err) {
          toast.error(`❌ Failed to upload ${file.name}`);
          console.error(err);
        }
      })
    );

    await triggerGridRefresh();
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
      </div>
    </div>
  );
};

export default VideoUpload;
