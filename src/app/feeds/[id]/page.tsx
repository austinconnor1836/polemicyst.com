'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';

type GeneratedClip = {
  id: string;
  videoTitle: string;
  s3Url: string | null;
  sharedDescription: string;
  createdAt: string;
};

type FeedVideoDetail = {
  id: string;
  title: string;
  s3Url: string;
  clipGenerationStatus: string;
  clipGenerationError: string | null;
  feed?: { name: string };
  userId?: string;
  generatedClips: GeneratedClip[];
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  idle: { text: 'Ready to generate', color: 'text-gray-500' },
  queued: { text: 'Queued for processing', color: 'text-yellow-600' },
  processing: { text: 'Generating clips...', color: 'text-blue-600' },
  completed: { text: 'Generation complete', color: 'text-green-600' },
  failed: { text: 'Generation failed', color: 'text-red-600' },
};

export default function FeedVideoDetailPage({ params }: { params: { id: string } }) {
  const [feedVideo, setFeedVideo] = useState<FeedVideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [isTriggering, setIsTriggering] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousClipCountRef = useRef(0);

  const fetchFeedVideo = useCallback(async () => {
    try {
      const res = await fetch(`/api/feedVideos/${params.id}`);
      if (!res.ok) throw new Error('Failed to fetch feed video');
      const data: FeedVideoDetail = await res.json();
      setFeedVideo(data);
      setError(null);
      return data;
    } catch (err) {
      setError('Failed to load feed video details');
      return null;
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchFeedVideo();
  }, [fetchFeedVideo]);

  const isActiveGeneration = feedVideo?.clipGenerationStatus === 'queued' || feedVideo?.clipGenerationStatus === 'processing';

  useEffect(() => {
    if (isActiveGeneration) {
      pollingRef.current = setInterval(async () => {
        const data = await fetchFeedVideo();
        if (data) {
          const newCount = data.generatedClips.length;
          if (newCount > previousClipCountRef.current) {
            previousClipCountRef.current = newCount;
          }
          if (data.clipGenerationStatus !== 'queued' && data.clipGenerationStatus !== 'processing') {
            if (pollingRef.current) clearInterval(pollingRef.current);
          }
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isActiveGeneration, fetchFeedVideo]);

  const handleGenerateClips = async () => {
    if (!feedVideo) return;
    setIsTriggering(true);

    try {
      const res = await fetch('/api/trigger-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedVideoId: feedVideo.id,
          userId: feedVideo.userId,
          aspectRatio,
        }),
      });

      if (!res.ok) throw new Error('Failed to trigger clip generation');

      setFeedVideo((prev) =>
        prev ? { ...prev, clipGenerationStatus: 'queued', clipGenerationError: null } : prev
      );
    } catch {
      setError('Failed to trigger clip generation');
    } finally {
      setIsTriggering(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !feedVideo) {
    return (
      <div className="p-6">
        <Link href="/feeds" className="text-blue-600 hover:underline flex items-center gap-1 mb-4">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Feeds
        </Link>
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded">{error}</div>
      </div>
    );
  }

  if (!feedVideo) return null;

  const statusInfo = STATUS_LABELS[feedVideo.clipGenerationStatus] || STATUS_LABELS.idle;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/feeds" className="text-blue-600 hover:underline flex items-center gap-1 mb-6">
        <ArrowLeftIcon className="h-4 w-4" /> Back to Feeds
      </Link>

      {/* Source Video Section */}
      <div className="bg-white dark:bg-[#292c35] rounded-lg shadow-md p-6 mb-6">
        <h1 className="text-2xl font-bold mb-1">{feedVideo.title}</h1>
        {feedVideo.feed && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Feed: {feedVideo.feed.name}</p>
        )}

        <div className="max-w-lg">
          <video
            src={feedVideo.s3Url}
            controls
            className="w-full rounded"
          />
        </div>
      </div>

      {/* Clip Generation Controls */}
      <div className="bg-white dark:bg-[#292c35] rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Clip Generation</h2>

        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Aspect Ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="p-2 border rounded dark:bg-gray-800 dark:border-gray-700"
              disabled={isActiveGeneration}
            >
              <option value="9:16">9:16 (Portrait)</option>
              <option value="16:9">16:9 (Landscape)</option>
              <option value="1:1">1:1 (Square)</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerateClips}
              disabled={isTriggering || isActiveGeneration}
              className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isTriggering ? 'Queuing...' : isActiveGeneration ? 'Generating...' : 'Generate Clips'}
            </button>

            <span className={`text-sm font-medium ${statusInfo.color}`}>
              {statusInfo.text}
            </span>
          </div>
        </div>

        {feedVideo.clipGenerationError && (
          <div className="mt-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded text-sm">
            {feedVideo.clipGenerationError}
          </div>
        )}

        {isActiveGeneration && (
          <div className="mt-4 flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {feedVideo.clipGenerationStatus === 'queued'
                ? 'Waiting in queue...'
                : `Processing clips${feedVideo.generatedClips.length > 0 ? ` (${feedVideo.generatedClips.length} generated so far)` : '...'}`}
            </span>
          </div>
        )}
      </div>

      {/* Generated Clips Section */}
      <div className="bg-white dark:bg-[#292c35] rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Generated Clips
            {feedVideo.generatedClips.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({feedVideo.generatedClips.length})
              </span>
            )}
          </h2>
        </div>

        {feedVideo.generatedClips.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {isActiveGeneration ? (
              <div className="flex flex-col items-center gap-3">
                <div className="animate-pulse text-blue-500">
                  <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <p>Clips are being generated. They will appear here as they are ready.</p>
              </div>
            ) : (
              <p>No clips generated yet. Click &ldquo;Generate Clips&rdquo; to get started.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {feedVideo.generatedClips.map((clip) => (
              <div
                key={clip.id}
                className="border dark:border-gray-700 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                {clip.s3Url ? (
                  <video
                    src={clip.s3Url}
                    controls
                    className="w-full aspect-video bg-black"
                  />
                ) : (
                  <div className="w-full aspect-video bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                  </div>
                )}
                <div className="p-3">
                  <h3 className="font-medium text-sm truncate">
                    {clip.videoTitle || 'Untitled Clip'}
                  </h3>
                  {clip.sharedDescription && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                      {clip.sharedDescription}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(clip.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
