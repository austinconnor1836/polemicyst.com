'use client';

import React, { useState, useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';
import axios from 'axios';

const ClipsGenie = () => {
  const { data: session } = useSession(); // Instagram & Facebook session
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [blueskyHandle, setBlueskyHandle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [isMetaPosting, setIsMetaPosting] = useState(false);

  useEffect(() => {
    const session = localStorage.getItem('blueskySession');
    if (session) {
      const parsedSession = JSON.parse(session);
      setIsAuthenticated(true);
      setBlueskyHandle(parsedSession.handle);
    }
  }, []);

  const BLUESKY_CHARACTER_LIMIT = 300;

  const handleBlueskyPost = async () => {
    setLoading(true);

    try {
      const sessionData = localStorage.getItem("blueskySession");
      if (!sessionData) {
        toast.error("You must be logged in to post.");
        return;
      }

      const session = JSON.parse(sessionData);

      // ✅ Ensure description fits within Bluesky's character limit
      let postText = description.trim();
      if (postText.length > BLUESKY_CHARACTER_LIMIT) {
        toast.error("Post is too long. Truncating to fit the limit.");
        postText = postText.substring(0, BLUESKY_CHARACTER_LIMIT) + "...";
      }

      const response = await fetch("/api/bluesky/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl, title, description: postText, session }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("Posted successfully to Bluesky!");
        setYoutubeUrl("");
        setTitle("");
        setDescription("");
        setIsPostModalOpen(false);
      } else {
        toast.error(result.message || "Failed to post.");
      }
    } catch (err) {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };


  // const handleBlueskyPost = async () => {
  //   setLoading(true);
  //   try {
  //     const sessionData = localStorage.getItem('blueskySession');
  //     if (!sessionData) {
  //       toast.error('You must be logged in to post.');
  //       return;
  //     }

  //     const session = JSON.parse(sessionData);

  //     const response = await fetch('/api/bluesky/post', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ youtubeUrl, title, description, session }),
  //     });

  //     const result = await response.json();

  //     if (response.ok) {
  //       toast.success('Posted successfully to Bluesky!');
  //       setYoutubeUrl('');
  //       setTitle('');
  //       setDescription('');
  //       setIsPostModalOpen(false);
  //     } else {
  //       toast.error(result.message || 'Failed to post.');
  //     }
  //   } catch (err) {
  //     toast.error('Something went wrong.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const handleMetaPost = async () => {
    if (!session?.accessToken) {
      toast.error('You must log in to Facebook first.');
      return;
    }

    setIsMetaPosting(true);

    try {
      // Step 1: Get Facebook Page & Instagram Business Account ID
      const { data: accountData } = await axios.post('/api/meta/account', {
        accessToken: session.accessToken,
      });

      // Step 2: Upload to Facebook
      await axios.post('/api/meta/uploadFacebook', {
        pageId: accountData.pageId,
        accessToken: session.accessToken,
        videoUrl,
        caption: description,
      });

      // Step 3: Upload to Instagram
      await axios.post('/api/meta/uploadInstagram', {
        instagramAccountId: accountData.instagramAccountId,
        accessToken: session.accessToken,
        videoUrl,
        caption: description,
      });

      toast.success('Video posted successfully to Facebook & Instagram!');
    } catch (error) {
      toast.error('Failed to post video.');
    } finally {
      setIsMetaPosting(false);
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      toast.error('Please enter both username and password.');
      return;
    }

    try {
      const response = await fetch('/api/bluesky/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (response.ok) {
        localStorage.setItem('blueskySession', JSON.stringify(result.session));
        setIsAuthenticated(true);
        setBlueskyHandle(result.session.handle);
        toast.success('Logged in successfully!');
        setIsLoginModalOpen(false);
      } else {
        toast.error(result.message || 'Login failed.');
      }
    } catch (err) {
      toast.error('Login error. Please try again.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('blueskySession');
    setIsAuthenticated(false);
    setBlueskyHandle('');
    toast.success('Logged out successfully!');
  };
  

  return (
    <div className="flex flex-col items-center p-16 space-y-4">
      <Toaster position="top-right" />

      <h1 className="text-2xl font-bold">Clips-Genie</h1>

      {/* Bluesky Authentication */}
      {!isAuthenticated ? (
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={() => setIsLoginModalOpen(true)}
        >
          Login to Bluesky
        </button>
      ) : (
        <div className="flex items-center space-x-4">
          <span>Logged in as {blueskyHandle}</span>
          <button
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      )}

      {/* Facebook & Instagram Authentication */}
      {!session ? (
        <button
          className="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800"
          onClick={() => signIn('facebook')}
        >
          Login to Facebook
        </button>
      ) : (
        <div className="flex items-center space-x-4">
          <span>Logged in with Facebook</span>
          <button
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            onClick={() => signOut()}
          >
            Logout
          </button>
        </div>
      )}

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={() => setIsPostModalOpen(true)}
      >
        Post Video
      </button>

      {/* Post Modal */}
      {isPostModalOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-40"
          style={{ overflow: "hidden", width: "100vw", height: "100vh" }} // Prevents page scrolling
        >
          <div
            className="bg-white dark:bg-[#292c35] text-gray-900 dark:text-[#E0E0E0] 
        p-6 rounded-lg shadow-xl sm:w-[500px] lg:w-[600px] xl:w-[700px] 
        max-w-[90vw] mx-4 min-w-[24rem] overflow-hidden relative z-50"
          >
            <h2 className="text-xl font-semibold mb-4">Post a Video</h2>

            <label className="block mb-2 text-sm font-medium">Video URL</label>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="w-full p-2 border rounded"
              placeholder="Enter Video URL"
            />

            <label className="block mt-4 mb-2 text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-[90%] lg:w-full p-2 border rounded h-32 sm:h-40 resize-none overflow-y-scroll"
              placeholder="Enter a custom description"
              rows={3}
            ></textarea>

            <div className="flex justify-between mt-4 space-x-2">
              {/* Cancel Button */}
              <button
                className="bg-gray-500 text-white text-sm px-3 py-1 rounded-md hover:bg-gray-600 transition"
                onClick={() => setIsPostModalOpen(false)}
              >
                Cancel
              </button>

              {/* Post to Bluesky Button */}
              <button
                className="bg-blue-600 text-white text-sm px-3 py-1 rounded-md hover:bg-blue-700 transition"
                onClick={handleBlueskyPost}
              >
                Post to Bluesky
              </button>

              {/* Post to Facebook & Instagram Button */}
              <button
                className="bg-green-600 text-white text-sm px-3 py-1 rounded-md hover:bg-green-700 transition disabled:bg-gray-400"
                onClick={handleMetaPost}
                disabled={isMetaPosting}
              >
                {isMetaPosting ? "Posting..." : "Post to Facebook & Instagram"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ClipsGenie;
