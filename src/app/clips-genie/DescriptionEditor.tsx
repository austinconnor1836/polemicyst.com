"use client";

import React from "react";
import { usePlatformContext } from "./PlatformContext";

const DescriptionEditor = () => {
  const {
    sharedDescription, setSharedDescription,
    facebookTemplate, setFacebookTemplate,
    instagramTemplate, setInstagramTemplate,
    youtubeTemplate, setYoutubeTemplate,
    blueskyTemplate, setBlueskyTemplate,
    twitterTemplate, setTwitterTemplate,
  } = usePlatformContext();

  return (
    <div>
      <label className="block mt-4 mb-2 text-sm font-medium">General Description</label>
      <textarea value={sharedDescription} onChange={(e) => setSharedDescription(e.target.value)} className="w-full p-2 border rounded h-32 resize-none"></textarea>

      {[
        { label: "Facebook", state: facebookTemplate, setState: setFacebookTemplate },
        { label: "Instagram", state: instagramTemplate, setState: setInstagramTemplate },
        { label: "YouTube", state: youtubeTemplate, setState: setYoutubeTemplate },
        { label: "Bluesky", state: blueskyTemplate, setState: setBlueskyTemplate },
        { label: "Twitter", state: twitterTemplate, setState: setTwitterTemplate },
      ].map(({ label, state, setState }) => (
        <div key={label} className="mt-4">
          <label className="block mb-2 text-sm font-medium">{label}</label>
          <textarea
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full p-2 border rounded h-24 resize-none"
          ></textarea>
        </div>
      ))}
    </div>
  );
};

export default DescriptionEditor;
