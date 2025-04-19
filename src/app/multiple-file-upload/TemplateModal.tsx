"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { usePlatformContext } from "./PlatformContext";


const TemplateModal: React.FC<> = () => {
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
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex justify-center items-center">
      <div className="bg-white dark:bg-gray-900 p-6 rounded shadow-md w-full max-w-lg">
        <h2 className="text-xl font-bold mb-4">Edit Template Preferences</h2>

        <label className="block text-sm font-medium mb-1">Shared Description (Postscript)</label>
        <textarea
          className="w-full p-2 mb-4 border rounded dark:text-black"
          value={sharedPostscript}
          onChange={(e) => setSharedPostscript(e.target.value)}
        />


        <label className="block text-sm font-medium mb-1">Facebook</label>
        <textarea
          className="w-full p-2 mb-4 border rounded dark:text-black"
          value={facebookTemplate}
          onChange={(e) => setFacebookTemplate(e.target.value)}
        />

        <label className="block text-sm font-medium mb-1">Instagram</label>
        <textarea
          className="w-full p-2 mb-4 border rounded dark:text-black"
          value={instagramTemplate}
          onChange={(e) => setInstagramTemplate(e.target.value)}
        />

        <label className="block text-sm font-medium mb-1">YouTube</label>
        <textarea
          className="w-full p-2 mb-4 border rounded dark:text-black"
          value={youtubeTemplate}
          onChange={(e) => setYoutubeTemplate(e.target.value)}
        />

        <div className="flex justify-end space-x-2">
          <button onClick={() => setShowTemplateModal(false)} className="px-4 py-2 bg-gray-500 text-white rounded">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded">
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateModal;
