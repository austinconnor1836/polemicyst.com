'use client';

import React, { useEffect, useState } from 'react';
import { usePlatformContext } from './PlatformContext';
import TemplateModal from './TemplateModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Video {
  id: string;
  fileName: string;
  s3Url: string;
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
  const {
    setActiveVideo,
    refreshGridToggle,
    showTemplateModal,
    setShowTemplateModal,
    selectedVideoIds,
    setSelectedVideoIds,
    toggleVideoSelection,
    uploadedVideos,
    setUploadedVideos
  } = usePlatformContext();
  const [isDeleting, setIsDeleting] = useState(false);

  // useEffect(() => {
  //   const fetchVideos = async () => {
  //     try {
  //       const response = await fetch('/api/videos');
  //       if (!response.ok) throw new Error('Failed to fetch videos');
  //       const data: Video[] = await response.json();
  //       setVideos(data);
  //     } catch (error) {
  //       console.error('Error fetching videos:', error);
  //     }
  //   };

  //   fetchVideos();
  // }, [refreshGridToggle]);

  const handleSelectAll = () => {
    if (selectedVideoIds.size === uploadedVideos.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(uploadedVideos.map((v) => v.id)));
    }
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

      setUploadedVideos((prev) => prev.filter((video) => !selectedVideoIds.has(video.id)));
      setSelectedVideoIds(new Set());
    } catch (error) {
      console.error('Error deleting videos:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setShowTemplateModal(true)}>
          Edit Post Templates
        </Button>
      </div>
      {showTemplateModal && (
        <TemplateModal />
      )}
      {uploadedVideos.length === 0 ? <p className="text-center text-gray-500 mt-8">No videos uploaded yet.</p> : <div className="mt-10">
        <div className="flex justify-between mb-2">
          <Button variant="ghost" size="sm" onClick={handleSelectAll} className="px-0 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            {selectedVideoIds.size === uploadedVideos.length ? 'Deselect All' : 'Select All'}
          </Button>

          <Button
            onClick={handleDeleteSelected}
            disabled={selectedVideoIds.size === 0 || isDeleting}
            variant="destructive"
            size="sm"
          >
            {isDeleting ? 'Deleting...' : 'Delete Selected'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {uploadedVideos.map((video) => (
            <Card key={video.id} className="relative shadow-sm dark:bg-gray-800">
              {/* Checkbox */}
              <input
                type="checkbox"
                className="absolute top-2 right-2"
                checked={selectedVideoIds.has(video.id)}
                onChange={() => toggleVideoSelection(video.id)}
                onClick={(e) => e.stopPropagation()}
              />

              {/* Clickable area */}
              <CardContent onClick={() => setActiveVideo(video)} className="cursor-pointer p-4">
                <h3 className="mb-2 truncate text-sm font-semibold">{video.videoTitle}</h3>

                {/* ✅ Actual video preview */}
                <video
                  src={video.s3Url ?? ""}
                  controls
                  className="w-full rounded max-h-48"
                />

                <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                  {video.sharedDescription}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>}
    </>
  )
};

export default VideoGrid;
