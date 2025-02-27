'use client';

import React, { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';

const ClipsGenie = () => {
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

  useEffect(() => {
    const session = localStorage.getItem('blueskySession');
    if (session) {
      const parsedSession = JSON.parse(session);
      setIsAuthenticated(true);
      setBlueskyHandle(parsedSession.handle);
    }
  }, []);

  const handlePost = async () => {
    setLoading(true);

    try {
      const sessionData = localStorage.getItem('blueskySession');
      if (!sessionData) {
        toast.error('You must be logged in to post.');
        return;
      }

      const session = JSON.parse(sessionData);

      const response = await fetch('/api/bluesky/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl, title, description, session }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success('Posted successfully to Bluesky!');
        setYoutubeUrl('');
        setTitle('');
        setDescription('');
        setIsPostModalOpen(false);
      } else {
        toast.error(result.message || 'Failed to post.');
      }
    } catch (err) {
      toast.error('Something went wrong.');
    } finally {
      setLoading(false);
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

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={() => setIsPostModalOpen(true)}
        disabled={!isAuthenticated}
      >
        Post to Bluesky
      </button>

      {/* Post Modal */}
      {isPostModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded shadow-lg w-96">
            <h2 className="text-xl font-semibold mb-4">Post to Bluesky</h2>

            <label className="block mb-2 text-sm font-medium">YouTube URL</label>
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full p-2 border rounded"
              placeholder="Enter YouTube URL"
            />

            <label className="block mt-4 mb-2 text-sm font-medium">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2 border rounded"
              placeholder="Enter video title"
            />

            <label className="block mt-4 mb-2 text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded"
              placeholder="Enter a custom description"
              rows={3}
            ></textarea>

            <div className="flex justify-between mt-4">
              <button
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                onClick={() => setIsPostModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
                onClick={handlePost}
                disabled={loading}
              >
                {loading ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClipsGenie;
