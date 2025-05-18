"use client";

import React from "react";
import toast from "react-hot-toast";
import { usePlatformContext } from "./PlatformContext";

const VideoUpload = () => {
  const { triggerGridRefresh, setFileInCache } = usePlatformContext();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles = Array.from(files);

    await Promise.all(
      newFiles.map(async (file) => {
        let title = file.name.replace(/\.[^/.]+$/, ""); // remove extension
        title = title.replace(/^#\d+\s*/, ""); // remove "#1 "
        title = title.replace(/_/g, ":"); // replace _ with :

        try {
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

          const res = await fetch("/api/videos", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`❌ Upload failed: ${errText}`);
          }

          const { videoId, s3Url } = await res.json();
          if (!videoId || !s3Url) throw new Error("Missing video ID or s3Url");

          // Optional: Cache file in memory
          // setFileInCache(videoId, file);

          // Step 2: Transcribe
          // const transcribeForm = new FormData();
          // transcribeForm.append("file", file);
          // transcribeForm.append("videoId", videoId);

          // console.log("📤 Calling /api/transcribe...");
          // const transcribeRes = await fetch("/api/transcribe", {
          //   method: "POST",
          //   body: transcribeForm,
          // });

          // if (!transcribeRes.ok) {
          //   const err = await transcribeRes.text();
          //   throw new Error("Transcription failed: " + err);
          // }

          // // Step 3: Generate description
          // const generateRes = await fetch("/api/generateDescription", {
          //   method: "POST",
          //   headers: { "Content-Type": "application/json" },
          //   body: JSON.stringify({ videoId }),
          // });

          // if (!generateRes.ok) {
          //   const err = await generateRes.text();
          //   throw new Error("Generation failed: " + err);
          // }
          toast.success(`✅ Uploaded ${file.name}`);
        } catch (err) {
          console.error(err);
          toast.error(`❌ Failed to upload ${file.name}`);
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