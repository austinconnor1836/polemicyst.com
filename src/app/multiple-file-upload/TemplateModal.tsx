"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { usePlatformContext } from "./PlatformContext";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";


const TemplateModal: React.FC = () => {
  const { setShowTemplateModal } = usePlatformContext();
  const [facebookTemplate, setFacebookTemplate] = useState("");
  const [instagramTemplate, setInstagramTemplate] = useState("");
  const [youtubeTemplate, setYoutubeTemplate] = useState("");
  const [sharedPostscript, setSharedPostscript] = useState("");

  useEffect(() => {
    const fetchTemplates = async () => {
      const res = await fetch("/api/templates");
      const data = await res.json();
      setFacebookTemplate(data.facebookTemplate || "");
      setInstagramTemplate(data.instagramTemplate || "");
      setYoutubeTemplate(data.youtubeTemplate || "");
      setSharedPostscript(data.sharedPostscript || "");
    };

    fetchTemplates();
  }, []);

  const handleSave = async () => {
    await axios.put("/api/templates", {
      facebookTemplate,
      instagramTemplate,
      youtubeTemplate,
      sharedPostscript
    });

    setShowTemplateModal(false);
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) setShowTemplateModal(false);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Template Preferences</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Shared Description (Postscript)</Label>
            <Textarea value={sharedPostscript} onChange={(e) => setSharedPostscript(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Facebook</Label>
            <Textarea value={facebookTemplate} onChange={(e) => setFacebookTemplate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Instagram</Label>
            <Textarea value={instagramTemplate} onChange={(e) => setInstagramTemplate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>YouTube</Label>
            <Textarea value={youtubeTemplate} onChange={(e) => setYoutubeTemplate(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="secondary" onClick={() => setShowTemplateModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateModal;
