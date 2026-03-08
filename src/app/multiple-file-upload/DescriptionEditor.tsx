'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { usePlatformContext } from './PlatformContext';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DescriptionEditor = () => {
  const { uploadedVideos, setUploadedVideos, selectedVideoIds, generateDescription, isGenerating } =
    usePlatformContext();

  const selectedVideos = useMemo(
    () => uploadedVideos.filter((v) => selectedVideoIds.has(v.id)),
    [uploadedVideos, selectedVideoIds]
  );

  const setSelectedVideos = useCallback(
    (updated: typeof uploadedVideos) => {
      setUploadedVideos((prev) => {
        const updatedMap = new Map(updated.map((v) => [v.id, v]));
        return prev.map((v) => updatedMap.get(v.id) ?? v);
      });
    },
    [setUploadedVideos]
  );

  const [activeVideoIndex, setActiveVideoIndex] = useState<number | null>(null);

  const handleInputChange = (
    index: number,
    field: keyof (typeof selectedVideos)[0],
    value: string
  ) => {
    const updated = [...selectedVideos];
    updated[index] = { ...updated[index], [field]: value };
    setSelectedVideos(updated);
  };

  return (
    <div>
      {/* Modal for editing */}
      {activeVideoIndex !== null && (
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setActiveVideoIndex(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Editing Video {activeVideoIndex + 1}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Video Title</Label>
                <Input
                  type="text"
                  value={selectedVideos[activeVideoIndex].videoTitle}
                  onChange={(e) =>
                    handleInputChange(activeVideoIndex, 'videoTitle', e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>General Description</Label>
                <Textarea
                  value={selectedVideos[activeVideoIndex].sharedDescription}
                  onChange={(e) =>
                    handleInputChange(activeVideoIndex, 'sharedDescription', e.target.value)
                  }
                  className="h-32 resize-none"
                />
              </div>

              {(
                [
                  'facebookTemplate',
                  'instagramTemplate',
                  'youtubeTemplate',
                  'blueskyTemplate',
                  'twitterTemplate',
                ] as const
              ).map((key) => (
                <div key={key} className="space-y-2">
                  <Label className="capitalize">{key.replace('Template', '')}</Label>
                  <Textarea
                    value={selectedVideos[activeVideoIndex][key]}
                    onChange={(e) => handleInputChange(activeVideoIndex, key, e.target.value)}
                    className="h-24 resize-none"
                  />
                </div>
              ))}
            </div>

            <DialogFooter className="pt-4">
              <Button variant="secondary" onClick={() => setActiveVideoIndex(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => generateDescription(selectedVideos[activeVideoIndex].id)}
                disabled={isGenerating}
              >
                {isGenerating ? 'Generating...' : 'Regenerate AI Description'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DescriptionEditor;
