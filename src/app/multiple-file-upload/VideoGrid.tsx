'use client';

import React, { useEffect, useState } from 'react';
import { usePlatformContext } from './PlatformContext';
import TemplateModal from './TemplateModal';

interface Video {
  id: string;
  fileName: string;
  s3Url: string; // ✅ NEW FIELD
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
  const { setActiveVideo, refreshGridToggle, showTemplateModal, setShowTemplateModal } = usePlatformContext();
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch('/api/videos');
        if (!response.ok) throw new Error('Failed to fetch videos');
        const data: Video[] = await response.json();
        setVideos(data);
      } catch (error) {
        console.error('Error fetching videos:', error);
      }
    };

    fetchVideos();
  }, [refreshGridToggle]);

  const handleSelectAll = () => {
    if (selectedVideoIds.size === videos.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(videos.map((video) => video.id)));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedVideoIds((prev) => {
      const updated = new Set(prev);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      return updated;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedVideoIds.size === 0) return;
    setIsDeleting(true);

    try {
      await Promise.all(
        Array.from(selectedVideoIds).map((id) =>
          fetch(`/api/videos/${id}`, { method: 'DELETE' })
        )
      );

      setVideos((prev) => prev.filter((video) => !selectedVideoIds.has(video.id)));
      setSelectedVideoIds(new Set());
    } catch (error) {
      console.error('Error deleting videos:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        className="mt-4 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
        onClick={() => setShowTemplateModal(true)}
      >
        Edit Post Templates
      </button>
      {showTemplateModal && (
        <TemplateModal />
      )}
      {videos.length === 0 ? <p className="text-center text-gray-500 mt-8">No videos uploaded yet.</p> : <div className="mt-10">
        <div className="flex justify-between mb-2">
          <button onClick={handleSelectAll} className="text-sm text-blue-600 hover:underline">
            {selectedVideoIds.size === videos.length ? 'Deselect All' : 'Select All'}
          </button>

          <button
            onClick={handleDeleteSelected}
            disabled={selectedVideoIds.size === 0 || isDeleting}
            className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:bg-gray-400"
          >
            {isDeleting ? 'Deleting...' : 'Delete Selected'}
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

              {/* Clickable area */}
              <div onClick={() => setActiveVideo(video)} className="cursor-pointer">
                <h3 className="font-semibold text-sm truncate mb-2">{video.videoTitle}</h3>

                {/* ✅ Actual video preview */}
                <video
                  src={video.s3Url}
                  controls
                  className="w-full rounded max-h-48"
                />

                <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                  {video.sharedDescription}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </>
  )
};

export default VideoGrid;
