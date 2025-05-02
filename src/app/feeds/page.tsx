'use client';

import { useState, useEffect } from 'react';

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

  useEffect(() => {
    fetchFeeds();
    fetchVideos();
  }, []);

  const addFeed = async () => {
    await fetch('/api/feeds', {
      method: 'POST',
      body: JSON.stringify(form),
      headers: { 'Content-Type': 'application/json' },
    });
    setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
    fetchFeeds();
  };

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
      <ul className="mb-10">
        {feeds.map((feed: any) => (
          <li key={feed.id} className="mb-2">
            <strong>{feed.name}</strong> — {feed.sourceUrl} — every {feed.pollingInterval} min
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
          </div>
        ))}
      </div>
    </div>
  );
}
