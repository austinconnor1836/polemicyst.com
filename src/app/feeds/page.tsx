'use client';

import { useState, useEffect } from 'react';
import ViralitySettings, { getStrictnessConfig, ScoringMode, StrictnessPreset } from "@/components/ViralitySettings";
import AspectRatioSelect, { type AspectRatio } from "@/components/AspectRatioSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FeedsHeroAnimation } from "@/app/feeds/_components/FeedsHeroAnimation";

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
      <div className="mb-8">
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-background to-background/60">
          <FeedsHeroAnimation className="absolute inset-0 opacity-90" />
          <div className="relative p-6 sm:p-8">
            <h1 className="text-2xl font-bold">Video Feeds</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              Create a feed, then generate clips from any ingested video.
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/85 via-background/20 to-transparent" />
        </div>
      </div>

      {/* Form */}
      <Card className="mb-8 max-w-3xl">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                placeholder="My YouTube channel"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Source URL</Label>
              <Input
                placeholder="https://..."
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Polling interval (min)</Label>
              <Input
                type="number"
                value={String(form.pollingInterval)}
                onChange={(e) => setForm({ ...form, pollingInterval: +e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addFeed}>Add Feed</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feed List */}
      <div className="mb-10 max-w-3xl">
        <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Feeds</div>
        <div className="space-y-2">
          {feeds.map((feed: any) => (
            <Card key={feed.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{feed.name}</div>
                  <div className="truncate text-xs text-gray-500">
                    {feed.sourceUrl} • every {feed.pollingInterval} min
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  onClick={() => deleteFeed(feed.id)}
                  title="Delete feed"
                >
                  <TrashIcon className="h-5 w-5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Video Grid */}
      <h2 className="text-xl font-semibold mb-4">Feed Videos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
  {videos.map((video) => (
          <Card
            key={video.id}
            className="cursor-pointer shadow-sm"
            onClick={() => { setSelectedVideo(video); setIsModalOpen(true); }}
          >
            <CardContent className="p-2">
              <video
                src={video.s3Url}
                controls
                className="w-full h-auto rounded pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="mt-2">
                <div className="font-semibold">{video.title}</div>
                <div className="text-xs text-gray-500">Feed: {video.feed?.name}</div>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
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
                </Button>
              </div>
            </CardContent>
          </Card>

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

            <video
              src={selectedVideo.s3Url}
              controls
              className="mb-4 max-h-[35vh] w-full rounded object-contain"
            />

            <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} className="mb-4" />
            <ViralitySettings value={viralitySettings} onChange={setViralitySettings} />

            <DialogFooter className="pt-4 sm:flex-col sm:space-x-0 sm:space-y-2">
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
