'use client';

import { useState, useEffect } from 'react';
import ViralitySettings, { getStrictnessConfig, ScoringMode, StrictnessPreset } from "@/components/ViralitySettings";
import AspectRatioSelect, { type AspectRatio } from "@/components/AspectRatioSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type FeedVideo = {
  id: string;
  title: string;
  s3Url: string;
  feed?: { name: string };
  userId?: string;
  aspectRatio?: string;
};
import { TrashIcon } from '@heroicons/react/24/solid';

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [form, setForm] = useState({ name: '', sourceUrl: '', pollingInterval: 60 });

  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [viralitySettings, setViralitySettings] = useState<{
    scoringMode: ScoringMode;
    strictnessPreset: StrictnessPreset;
    includeAudio: boolean;
    showAdvanced: boolean;
  }>({
    scoringMode: "hybrid",
    strictnessPreset: "balanced",
    includeAudio: false,
    showAdvanced: false,
  });

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
      const strictnessConfig = getStrictnessConfig(viralitySettings.strictnessPreset);
      const res = await fetch('/api/trigger-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedVideoId: video.id,
          userId: video.userId,
          aspectRatio: video.aspectRatio || "9:16",
          scoringMode: viralitySettings.scoringMode,
          includeAudio: viralitySettings.includeAudio,
          ...strictnessConfig,
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
  {videos.map((video) => (
          <div
            key={video.id}
            className="border p-2 rounded shadow cursor-pointer"
            onClick={() => { setSelectedVideo(video); setIsModalOpen(true); }}
          >
            <video
              src={video.s3Url}
              controls
              className="w-full h-auto rounded pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-2">
              <div className="font-semibold">{video.title}</div>
              <div className="text-xs text-gray-500">Feed: {video.feed?.name}</div>
              <button
                className="mt-2 text-red-600 hover:text-red-800 flex items-center"
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
                <TrashIcon className="h-4 w-4 mr-1" /> Delete
              </button>
            </div>
          </div>

        ))}
      </div>

      {/* Modal */}
  {selectedVideo && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{selectedVideo.title}</DialogTitle>
              <DialogDescription>Configure clip generation settings.</DialogDescription>
            </DialogHeader>

            <video src={selectedVideo.s3Url} controls className="w-full rounded mb-4" />

            <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} className="mb-4" />
            <ViralitySettings value={viralitySettings} onChange={setViralitySettings} />

            <div className="mt-4 flex flex-col gap-2">
              <Button
                onClick={async () => {
                  await triggerClip({ ...selectedVideo, aspectRatio });
                  setIsModalOpen(false);
                }}
              >
                Generate Clip
              </Button>
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
