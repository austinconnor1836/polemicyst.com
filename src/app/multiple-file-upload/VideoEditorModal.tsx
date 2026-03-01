'use client';

import React, { useState } from 'react';
import toast from 'react-hot-toast';
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

const VideoEditorModal = () => {
  const { activeVideo, setActiveVideo, regenerateDescription, triggerGridRefresh } =
    usePlatformContext();

  const [isSaving, setIsSaving] = useState(false);

  if (!activeVideo) return null;

  const updateField = (field: keyof typeof activeVideo, value: string) => {
    setActiveVideo((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    if (!activeVideo?.id) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/videos/${activeVideo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeVideo),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }

      toast.success('✅ Video saved');
      triggerGridRefresh();
      setActiveVideo(null);
    } catch (err) {
      console.error('Error saving video:', err);
      toast.error('❌ Failed to save video');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = () => {
    if (activeVideo?.id) {
      regenerateDescription(activeVideo.id);
    }
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) setActiveVideo(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Video: {activeVideo.videoTitle}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Video Title</Label>
            <Input
              type="text"
              value={activeVideo.videoTitle}
              onChange={(e) => updateField('videoTitle', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>General Description</Label>
            <Textarea
              value={activeVideo.sharedDescription}
              onChange={(e) => updateField('sharedDescription', e.target.value)}
              className="h-32 resize-none"
            />
          </div>

          {[
            { key: 'facebookTemplate', label: 'Facebook' },
            { key: 'instagramTemplate', label: 'Instagram' },
            { key: 'youtubeTemplate', label: 'YouTube' },
            { key: 'blueskyTemplate', label: 'Bluesky' },
            { key: 'twitterTemplate', label: 'Twitter' },
          ].map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <Label>{label}</Label>
              <Textarea
                value={(activeVideo as any)[key] || ''}
                onChange={(e) => updateField(key as keyof typeof activeVideo, e.target.value)}
                className="h-24 resize-none"
              />
            </div>
          ))}
        </div>

        <DialogFooter className="pt-4">
          <Button variant="secondary" onClick={() => setActiveVideo(null)}>
            Close
          </Button>
          <Button variant="outline" onClick={handleRegenerate}>
            Regenerate
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 dark:bg-green-600 dark:text-white dark:hover:bg-green-700"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VideoEditorModal;
