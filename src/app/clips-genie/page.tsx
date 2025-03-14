"use client";

import React, { useState, useEffect } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import toast, { Toaster } from "react-hot-toast";
import axios from "axios";

const ClipsGenie = () => {
  const { data: session } = useSession(); // Instagram & Facebook session
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [isMetaPosting, setIsMetaPosting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  useEffect(() => {
    const sessionData = localStorage.getItem("blueskySession");
    if (sessionData) {
      const parsedSession = JSON.parse(sessionData);
      setIsAuthenticated(true);
      setBlueskyHandle(parsedSession.handle);
    }
  }, []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setVideoPreview(URL.createObjectURL(file));
      await generateDescription(file); // Automatically generate description
    }
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setVideoPreview(URL.createObjectURL(file));
      await generateDescription(file); // Automatically generate description
    }
  };

  const generateDescription = async (file: File) => {
    setIsGeneratingDescription(true);
    setDescription("Generating description...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await axios.post("/api/generateDescription", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Ensure response contains valid data
      console.log('response.data', response.data);
      const { description, hashtags } = response.data;

      if (description && hashtags) {
        // Predefined hashtags
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

        // Merge AI-generated hashtags with fixed ones
        const allHashtags = [...fixedHashtags, ...hashtags];

        // Convert hashtags array into a comma-separated string
        const hashtagsString = allHashtags.join(", ");

        // Patreon link
        const patreonLink = "\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst";

        // Final formatted description
        const finalDescription = `${description}\n\n${hashtagsString}${patreonLink}`;

        setDescription(finalDescription);
      } else {
        setDescription("Failed to generate description.");
      }
    } catch (error) {
      console.error("Error generating description:", error);
      toast.error("Failed to generate description.");
      setDescription("Failed to generate description.");
    } finally {
      setIsGeneratingDescription(false);
    }
  };




  const handleMetaPost = async () => {
    if (!session?.accessToken) {
      toast.error("You must log in to Facebook first.");
      return;
    }

    if (!selectedFile) {
      toast.error("Please select a video file.");
      return;
    }

    setIsMetaPosting(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("description", description);
      formData.append("accessToken", session.accessToken);

      const response = await axios.post("/api/meta/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const { facebookVideoId, instagramPostId } = response.data;

      if (facebookVideoId) {
        toast.success(`✅ Facebook upload successful! Video ID: ${facebookVideoId}`);
      }

      if (instagramPostId) {
        toast.success(`✅ Instagram upload successful! Post ID: ${instagramPostId}`);
      }
    } catch (error) {
      toast.error("❌ Failed to upload video.");
    } finally {
      setIsMetaPosting(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-16 space-y-4">
      <Toaster position="top-right" />

      <h1 className="text-2xl font-bold">Clips-Genie</h1>

      {!isAuthenticated ? (
        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700" onClick={() => setIsLoginModalOpen(true)}>
          Login to Bluesky
        </button>
      ) : (
        <div className="flex items-center space-x-4">
          <span>Logged in as {blueskyHandle}</span>
          <button className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600" onClick={() => {
            localStorage.removeItem("blueskySession");
            setIsAuthenticated(false);
            setBlueskyHandle("");
            toast.success("Logged out successfully!");
          }}>
            Logout
          </button>
        </div>
      )}

      {!session ? (
        <button className="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800" onClick={() => signIn("facebook")}>
          Login to Facebook
        </button>
      ) : (
        <div className="flex items-center space-x-4">
          <span>Logged in with Facebook</span>
          <button className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600" onClick={() => signOut()}>
            Logout
          </button>
        </div>
      )}

      <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700" onClick={() => setIsPostModalOpen(true)}>
        Post Video
      </button>

      {isPostModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-40">
          <div className="bg-white dark:bg-[#292c35] text-gray-900 dark:text-[#E0E0E0] p-6 rounded-lg shadow-xl sm:w-[500px] lg:w-[600px] xl:w-[700px] max-w-[90vw] mx-4 min-w-[24rem] overflow-hidden relative z-50">
            <h2 className="text-xl font-semibold mb-4">Post a Video</h2>

            <button
              className={`absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-md transition ${!selectedFile || isGeneratingDescription ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600"
                }`}
              onClick={() => selectedFile && generateDescription(selectedFile)}
              disabled={!selectedFile || isGeneratingDescription}
            >
              {isGeneratingDescription ? "Generating..." : "Regenerate AI Description"}
            </button>

            <label className="block mb-2 text-sm font-medium">Video URL</label>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="w-full p-2 border rounded"
              placeholder="Enter Video URL"
            />

            <label className="block mb-2 text-sm font-medium">Upload Video File</label>
            <div
              className="border-2 border-dashed border-gray-400 p-6 text-center rounded-lg mt-4 cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
            >
              <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" id="fileUpload" />
              <label htmlFor="fileUpload" className="block mt-2 bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700">
                Choose from device
              </label>
              {selectedFile && <p className="text-xs text-gray-500 mt-2">{selectedFile.name}</p>}
            </div>

            {videoPreview && <video className="mt-4 w-full max-h-40" controls><source src={videoPreview} type="video/mp4" /></video>}

            <label className="block mt-4 mb-2 text-sm font-medium">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-[90%] lg:w-full p-2 border rounded h-32 sm:h-40 resize-none"></textarea>

            <button className="bg-green-600 text-white text-sm px-3 py-1 rounded-md hover:bg-green-700 transition" onClick={handleMetaPost} disabled={isMetaPosting}>
              {isMetaPosting ? "Posting..." : "Post to Facebook & Instagram"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClipsGenie;
