'use client';

import React, { useState } from 'react';
import { usePlatformContext } from './PlatformContext';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DescriptionEditor = () => {
  const { data: session } = useSession();
  const {
    sharedDescription,
    setSharedDescription,
    facebookTemplate,
    setFacebookTemplate,
    instagramTemplate,
    setInstagramTemplate,
    youtubeTemplate,
    setYoutubeTemplate,
    blueskyTemplate,
    setBlueskyTemplate,
    twitterTemplate,
    setTwitterTemplate,
    selectedPlatforms,
    selectedFile,
    videoTitle,
    setVideoTitle,
  } = usePlatformContext();

  const [isPosting, setIsPosting] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);

  const handlePostToSelectedPlatforms = async () => {
    if (!selectedFile) {
      toast.error('No video file selected.');
      return;
    }

    if (!selectedPlatforms || selectedPlatforms.length === 0) {
      toast.error('No platforms selected.');
      return;
    }

    if (
      selectedPlatforms.includes('bluesky') &&
      !selectedPlatforms.includes('google') &&
      !youtubeUrl
    ) {
      setShowYouTubeModal(true);
      return;
    }

    setIsPosting(true);
    const results: any[] = [];

    const descriptions: Record<string, string> = {
      facebook: `${sharedDescription}\n\n${facebookTemplate}`,
      instagram: `${sharedDescription}\n\n${instagramTemplate}`,
      google: `${sharedDescription}\n\n${youtubeTemplate}`,
      bluesky: blueskyTemplate,
      twitter: twitterTemplate,
    };

    const endpointMap: Record<string, string> = {
      bluesky: '/api/bluesky/post',
      facebook: '/api/meta/upload/facebook',
      instagram: '/api/meta/upload/instagram',
      google: '/api/youtube/upload',
      twitter: '/api/twitter/post',
    };

    let uploadedYouTubeUrl = youtubeUrl;

    // ✅ Upload to YouTube first if selected
    if (selectedPlatforms.includes('google')) {
      try {
        const ytForm = new FormData();
        ytForm.append('file', selectedFile);
        ytForm.append('title', videoTitle);
        ytForm.append('description', descriptions.google);
        ytForm.append('userId', session?.user.id!);

        const ytRes = await axios.post(endpointMap.google, ytForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        uploadedYouTubeUrl = ytRes.data.youtubeLink;
        results.push({ platform: 'youtube', success: true });
      } catch (err: any) {
        results.push({
          platform: 'youtube',
          success: false,
          error: err.response?.data || err.message,
        });
        toast.error('YouTube upload failed. Skipping Bluesky.');
        // Remove Bluesky from selectedPlatforms if YouTube failed
        return setIsPosting(false);
      }
    }

    // ✅ Post to other platforms
    for (const platform of selectedPlatforms) {
      if (platform === 'google') continue;

      try {
        if (!endpointMap[platform]) {
          results.push({ platform, success: false, error: 'Unknown platform' });
          continue;
        }

        if (platform === 'facebook' || platform === 'instagram') {
          const form = new FormData();
          form.append('file', selectedFile);
          form.append('description', descriptions[platform]);
          // form.append("accessToken", session?.user.facebookAccessToken || "");
          form.append('userId', session?.user.id!);

          await axios.post(endpointMap[platform], form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } else {
          // post to bluesky
          await axios.post(endpointMap[platform], {
            youtubeUrl: uploadedYouTubeUrl,
            description: descriptions[platform],
            userId: session?.user.id,
          });
        }

        results.push({ platform, success: true });
      } catch (err: any) {
        results.push({ platform, success: false, error: err.response?.data || err.message });
      }
    }

    console.log('✅ Post Results:', results);
    toast.success('Posting completed!');

    setIsPosting(false);
  };

  return (
    <div>
      <div className="mt-4 space-y-2">
        <Label>Video Title</Label>
        <Input type="text" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} />
      </div>

      <div className="mt-4 space-y-2">
        <Label>General Description</Label>
        <Textarea
          value={sharedDescription}
          onChange={(e) => setSharedDescription(e.target.value)}
          className="h-32 resize-none"
        />
      </div>

      {[
        { label: 'Facebook', state: facebookTemplate, setState: setFacebookTemplate },
        { label: 'Instagram', state: instagramTemplate, setState: setInstagramTemplate },
        { label: 'YouTube', state: youtubeTemplate, setState: setYoutubeTemplate },
        { label: 'Bluesky', state: blueskyTemplate, setState: setBlueskyTemplate },
        { label: 'Twitter', state: twitterTemplate, setState: setTwitterTemplate },
      ].map(({ label, state, setState }) => (
        <div key={label} className="mt-4">
          <Label className="mb-2 block">{label}</Label>
          <Textarea
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="h-24 resize-none"
          />
        </div>
      ))}

      <div className="flex justify-end items-center gap-4 mt-6">
        <Button variant="secondary" onClick={() => toast('Editing canceled.')}>
          Cancel
        </Button>
        <Button onClick={handlePostToSelectedPlatforms} disabled={isPosting}>
          {isPosting ? 'Posting...' : 'Post to Selected Platforms'}
        </Button>
      </div>

      {showYouTubeModal && (
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setShowYouTubeModal(false);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>YouTube URL Required</DialogTitle>
              <DialogDescription>
                You need to provide a YouTube URL for posting on Bluesky.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>YouTube URL</Label>
              <Input
                type="text"
                placeholder="https://youtube.com/..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-4">
              <Button variant="secondary" onClick={() => setShowYouTubeModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowYouTubeModal(false);
                  handlePostToSelectedPlatforms();
                }}
                disabled={!youtubeUrl}
              >
                Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DescriptionEditor;
