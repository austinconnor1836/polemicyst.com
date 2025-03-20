"use client";

import React, { useState, useEffect } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import toast, { Toaster } from "react-hot-toast";
import axios from "axios";
import { CheckCircle } from "@mui/icons-material";
import { FaFacebook, FaTwitter, FaInstagram, FaYoutube } from "react-icons/fa";
import { SiBluesky } from "react-icons/si";
import LoginButtons from "../_components/login-buttons";




const ClipsGenie = () => {
  const { data: session } = useSession(); // Instagram & Facebook session
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [facebookTemplate, setFacebookTemplate] = useState(
    `For more from Polemicyst:\n
Youtube: https://www.youtube.com/@Polemicyst
Twitter: https://x.com/Polemicyst
Instagram: https://www.instagram.com/polemicyst/
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );

  const [instagramTemplate, setInstagramTemplate] = useState(
    `For more from Polemicyst:\n
Youtube: https://www.youtube.com/@Polemicyst
Twitter: https://x.com/Polemicyst
Facebook: https://www.facebook.com/profile.php?id=61573192766929
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );
  const [youtubeTemplate, setYoutubeTemplate] = useState(
    `For more from Polemicyst:\n
Twitter: https://x.com/Polemicyst
Instagram: https://www.instagram.com/polemicyst/
Facebook: https://www.facebook.com/profile.php?id=61573192766929
Bluesky: https://bsky.app/profile/polemicyst.bsky.social
Threads: https://www.threads.net/@polemicyst`
  );
  const [blueskyTemplate, setBlueskyTemplate] = useState("");
  const [twitterTemplate, setTwitterTemplate] = useState("");
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

   // ✅ Ensure each platform includes a `provider` field
  const platforms = [
    { name: "Bluesky", icon: <SiBluesky className="text-blue-500 text-xl" />, provider: "bluesky" },
    { name: "Facebook", icon: <FaFacebook className="text-blue-600 text-xl" />, provider: "facebook" },
    { name: "Instagram", icon: <FaInstagram className="text-pink-500 text-xl" />, provider: "instagram" },
    { name: "YouTube", icon: <FaYoutube className="text-red-600 text-xl" />, provider: "google" },
    { name: "Twitter", icon: <FaTwitter className="text-blue-400 text-xl" />, provider: "twitter" },
  ];

  // Map authentication tokens from session
  const providerAccessTokens: Record<string, string | undefined> = {
    facebook: session?.user?.facebookAccessToken,
    instagram: session?.user?.instagramAccessToken,
    google: session?.user?.googleAccessToken,
    bluesky: session?.user?.blueskyAccessToken,
    twitter: session?.user?.twitterAccessToken,
  };

  const togglePlatform = (provider: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

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
      console.log("response.data", response.data);
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

        // ✅ Generate a 300-character version for Bluesky and Twitter
        const maxLength = 300;
        const trimmedDescription = `${description} ${hashtagsString}`.substring(0, maxLength).trim();

        setBlueskyTemplate(trimmedDescription);
        setTwitterTemplate(trimmedDescription);
      } else {
        setDescription("Failed to generate description.");
        setBlueskyTemplate("Failed to generate description.");
        setTwitterTemplate("Failed to generate description.");
      }
    } catch (error) {
      console.error("Error generating description:", error);
      toast.error("Failed to generate description.");
      setDescription("Failed to generate description.");
      setBlueskyTemplate("Failed to generate description.");
      setTwitterTemplate("Failed to generate description.");
    } finally {
      setIsGeneratingDescription(false);
    }
  };


  const handleMetaPost = async () => {
    if (!session?.user.facebookAccessToken) {
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
      formData.append("accessToken", session.user.facebookAccessToken);

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

      {/* {!isAuthenticated ? (
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
      )} */}

      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">Post a Video</h2>
          <button
            className="bg-blue-500 text-white px-3 py-1 rounded-md transition hover:bg-blue-600"
            onClick={() => selectedFile && generateDescription(selectedFile)}
            disabled={!selectedFile || isGeneratingDescription}
          >
            {isGeneratingDescription ? 'Generating...' : 'Regenerate AI Description'}
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row mt-6 gap-6">
          {/* Left Column: Platforms List */}
          <div className="md:w-1/4 bg-gray-100 dark:bg-[#1e1e1e] p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Platforms</h3>
          <ul className="space-y-2">
            {platforms.map(({ name, icon, provider }) => {
              const isAuthenticated = !!providerAccessTokens[provider];

              return (
                <li
                  key={provider}
                  className={`flex items-center justify-between p-2 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#292c35] rounded-md transition ${
                    selectedPlatforms.includes(provider) ? "bg-green-200 dark:bg-green-700" : ""
                  }`}
                  onClick={() => togglePlatform(provider)}
                >
                  <span className="flex items-center gap-2">
                    {icon}
                    {name}
                  </span>
                  {isAuthenticated ? (
                    <CheckCircle className="text-green-500" />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        signIn(provider);
                      }}
                      className="text-sm text-blue-500 hover:underline"
                    >
                      Connect
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>


          {/* Right Column: Upload & Descriptions */}
          <div className="md:w-3/4 p-6 bg-white dark:bg-[#292c35] shadow-md rounded-lg">
            {/* File Upload */}
            <label className="block mb-2 text-sm font-medium">Upload Video File</label>
            <div className="border-2 border-dashed border-gray-400 p-6 text-center rounded-lg cursor-pointer">
              <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" id="fileUpload" />
              <label htmlFor="fileUpload" className="block mt-2 bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700">
                Choose from device
              </label>
              {selectedFile && <p className="text-xs text-gray-500 mt-2">{selectedFile.name}</p>}
            </div>

            {/* Shared Description */}
            <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2 border rounded h-32 resize-none"></textarea>

            {/* Platform-Specific Descriptions */}
            <h3 className="text-lg font-semibold mt-6">Platform-Specific Descriptions</h3>

            {[
              { label: 'Facebook', state: facebookTemplate, setState: setFacebookTemplate },
              { label: 'Instagram', state: instagramTemplate, setState: setInstagramTemplate },
              { label: 'YouTube', state: youtubeTemplate, setState: setYoutubeTemplate },
              { label: 'Bluesky', state: blueskyTemplate, setState: setBlueskyTemplate },
              { label: 'Twitter', state: twitterTemplate, setState: setTwitterTemplate },
            ].map(({ label, state, setState }) => (
              <div key={label} className="mt-4">
                <label className="block mb-2 text-sm font-medium">{label}</label>
                <textarea value={state} onChange={(e) => setState(e.target.value)} className="w-full p-2 border rounded h-24 resize-none"></textarea>
              </div>
            ))}

            {/* Action Buttons */}
            <div className="flex justify-between items-center mt-6">
              <button className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition">
                ✖ Cancel
              </button>
              <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition" onClick={handleMetaPost} disabled={isMetaPosting}>
                {isMetaPosting ? 'Posting...' : 'Post to Selected Platforms'}
              </button>
            </div>
          </div>
        </div>
      </div>



    </div>
  );
};

export default ClipsGenie;
