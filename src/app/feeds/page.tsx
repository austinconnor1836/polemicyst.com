'use client';

import { useState, useEffect } from 'react';
import { TrashIcon } from '@heroicons/react/24/solid';

export default function FeedsPage() {
  const [feeds, setFeeds] = useState([]);
  const [videos, setVideos] = useState([]);
  const [form, setForm] = useState({ name: '', sourceUrl: '', pollingInterval: 60 });

  const fetchFeeds = async () => {
    const res = await fetch('/api/feeds');
    const data = await res.json();
    setFeeds(data);
  };

  const fetchVideos = async () => {
    const res = await fetch('/api/feedVideos');
    const data = await res.json();
    setVideos(data);
  };

  const addFeed = async () => {
    await fetch('/api/feeds', {
      method: 'POST',
      body: JSON.stringify(form),
      headers: { 'Content-Type': 'application/json' },
    });
    setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
    fetchFeeds();
  };

  const triggerClip = async (video: any) => {
    try {
      const res = await fetch('/api/trigger-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedVideoId: video.id,
          userId: video.userId
        }),

      });

      if (!res.ok) throw new Error('Failed to trigger clip');

      const data = await res.json();
      console.log('✅ Job enqueued:', data);
      alert(`Clip job enqueued for "${video.title}"`);
    } catch (err) {
      console.error(err);
      alert('Failed to trigger clip job');
    }
  };

  const deleteFeed = async (feedId: string) => {
    const res = await fetch(`/api/feeds/${feedId}`, { method: 'DELETE' });
    if (res.ok) {
      fetchFeeds(); // refresh feed list
    } else {
      alert('Failed to delete feed');
    }
  };

  useEffect(() => {
    fetchFeeds();
    fetchVideos();
  }, []);


  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Video Feeds</h1>

      {/* Form */}
      <div className="mb-6">
        <input
          placeholder="Name"
          className="border p-2 mr-2"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Source URL"
          className="border p-2 mr-2"
          value={form.sourceUrl}
          onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
        />
        <input
          type="number"
          placeholder="Polling Interval"
          className="border p-2 mr-2"
          value={form.pollingInterval}
          onChange={(e) => setForm({ ...form, pollingInterval: +e.target.value })}
        />
        <button onClick={addFeed} className="bg-blue-600 text-white p-2 rounded">
          Add Feed
        </button>
      </div>

      {/* Feed List */}
      <ul className="mb-10 max-w-3xl mx-auto w-full">
        {feeds.map((feed: any) => (
          <li
            key={feed.id}
            className="mb-2 flex items-center justify-between p-2 rounded hover:bg-gray-600 transition-colors"
          >
            <span>
              <strong>{feed.name}</strong> — {feed.sourceUrl} — every {feed.pollingInterval} min
            </span>
            <button
              onClick={() => deleteFeed(feed.id)}
              className="text-red-600 hover:text-red-800 ml-2"
              title="Delete feed"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </li>
        ))}
      </ul>

      {/* Video Grid */}
      <h2 className="text-xl font-semibold mb-4">Feed Videos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {videos.map((video: any) => (
          <div key={video.id} className="border p-2 rounded shadow">
            <video
              src={video.s3Url}
              controls
              className="w-full h-auto rounded"
            />
            <div className="mt-2">
              <div className="font-semibold">{video.title}</div>
              <div className="text-xs text-gray-500">Feed: {video.feed?.name}</div>
            </div>
            <button
              onClick={() => triggerClip(video)}
              className="mt-2 bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
            >
              Generate Clip
            </button>
          </div>
        ))}

      </div>
    </div>
  );
}
