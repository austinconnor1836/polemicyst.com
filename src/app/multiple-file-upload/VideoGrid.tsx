'use client';

import React, { useEffect, useState } from 'react';
import { usePlatformContext } from './PlatformContext';

interface Video {
  id: string;
  fileName: string;
  videoTitle: string;
  sharedDescription: string;
  facebookTemplate: string;
  instagramTemplate: string;
  youtubeTemplate: string;
  blueskyTemplate: string;
  twitterTemplate: string;
  createdAt: string;
}

const VideoGrid = () => {
  const { setActiveVideo } = usePlatformContext(); // ← use ID instead of index
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch('/api/videos');
        if (!response.ok) {
          throw new Error('Failed to fetch videos');
        }
        const data: Video[] = await response.json();
        setVideos(data);
      } catch (error) {
        console.error('Error fetching videos:', error);
      }
    };

    fetchVideos();
  }, []);

  const handleSelectAll = () => {
    if (selectedVideoIds.size === videos.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(videos.map((video) => video.id)));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedVideoIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  if (videos.length === 0) {
    return <p className="text-center text-gray-500 mt-8">No videos uploaded yet.</p>;
  }

  return (
    <div className="mt-10">
      <div className="flex justify-end mb-2">
        <button onClick={handleSelectAll} className="text-sm text-blue-600 hover:underline">
          {selectedVideoIds.size === videos.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {videos.map((video) => (
          <div
            key={video.id}
            className="relative border rounded-lg p-4 shadow-sm bg-white dark:bg-gray-800"
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              className="absolute top-2 right-2"
              checked={selectedVideoIds.has(video.id)}
              onChange={() => toggleSelection(video.id)}
              onClick={(e) => e.stopPropagation()}
            />

            {/* Clickable area for modal */}
            <div onClick={() => setActiveVideo(video)} className="cursor-pointer">
              <h3 className="font-semibold text-sm truncate mb-2">{video.videoTitle}</h3>
              <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                <span className="text-gray-500">Video Preview</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                {video.sharedDescription}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoGrid;
