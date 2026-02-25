'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TrashIcon } from '@heroicons/react/24/solid';

type FeedVideo = {
  id: string;
  title: string;
  s3Url: string;
  feed?: { name: string };
  userId?: string;
  aspectRatio?: string;
  clipGenerationStatus?: string;
  _count?: { generatedClips: number };
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: 'No clips', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  queued: { label: 'Queued', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  processing: { label: 'Generating...', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse' },
  completed: { label: 'Clips ready', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
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

  const deleteFeed = async (feedId: string) => {
    const res = await fetch(`/api/feeds/${feedId}`, { method: 'DELETE' });
    if (res.ok) {
      fetchFeeds();
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
        {videos.map((video) => {
          const status = video.clipGenerationStatus || 'idle';
          const badge = STATUS_BADGE[status] || STATUS_BADGE.idle;
          const clipCount = video._count?.generatedClips || 0;

          return (
            <div
              key={video.id}
              className="border dark:border-gray-700 rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden"
            >
              <video
                src={video.s3Url}
                controls
                className="w-full h-auto"
              />
              <div className="p-3">
                <div className="font-semibold truncate">{video.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Feed: {video.feed?.name}
                </div>

                {/* Status badge */}
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  {clipCount > 0 && (
                    <span className="text-xs text-gray-500">
                      {clipCount} clip{clipCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-3">
                  <Link
                    href={`/feeds/${video.id}`}
                    className="flex-1 text-center bg-blue-600 text-white text-sm px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
                  >
                    View Details
                  </Link>
                  <button
                    className="text-red-600 hover:text-red-800 p-1.5"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`Delete video '${video.title}'?`)) {
                        const res = await fetch('/api/feedVideos/delete', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: video.id })
                        });
                        if (res.ok) {
                          setVideos(videos.filter((v: any) => v.id !== video.id));
                        } else {
                          alert('Failed to delete video');
                        }
                      }
                    }}
                    title="Delete video"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
