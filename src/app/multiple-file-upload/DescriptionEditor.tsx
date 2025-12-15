"use client";

import React, { useState } from "react";
import { usePlatformContext } from "./PlatformContext";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DescriptionEditor = () => {
  const {
    selectedVideos,
    setSelectedVideos,
    generateDescription,
  } = usePlatformContext();

  const [activeVideoIndex, setActiveVideoIndex] = useState<number | null>(null);

  const handleInputChange = (index: number, field: keyof (typeof selectedVideos)[0], value: string) => {
    const updated = [...selectedVideos];
    updated[index][field] = value;
    setSelectedVideos(updated);
  };

  return (
    <div>

      {/* Modal for editing */}
      {activeVideoIndex !== null && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setActiveVideoIndex(null) }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Editing Video {activeVideoIndex + 1}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Video Title</Label>
                <Input
                  type="text"
                  value={selectedVideos[activeVideoIndex].title}
                  onChange={(e) => handleInputChange(activeVideoIndex, "title", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>General Description</Label>
                <Textarea
                  value={selectedVideos[activeVideoIndex].sharedDescription}
                  onChange={(e) => handleInputChange(activeVideoIndex, "sharedDescription", e.target.value)}
                  className="h-32 resize-none"
                />
              </div>

            {([
              "facebookTemplate",
              "instagramTemplate",
              "youtubeTemplate",
              "blueskyTemplate",
              "twitterTemplate"
            ] as const).map((key) => (
              <div key={key} className="space-y-2">
                <Label className="capitalize">{key.replace("Template", "")}</Label>
                <Textarea
                  value={selectedVideos[activeVideoIndex][key]}
                  onChange={(e) =>
                    handleInputChange(
                      activeVideoIndex,
                      key,
                      e.target.value
                    )
                  }
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
                onClick={() => generateDescription(activeVideoIndex)}
                disabled={selectedVideos[activeVideoIndex].isGenerating}
              >
                {selectedVideos[activeVideoIndex].isGenerating ? "Generating..." : "Regenerate AI Description"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DescriptionEditor;
