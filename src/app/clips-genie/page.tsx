"use client";

import React from "react";
import { PlatformProvider } from "./PlatformContext";
import PlatformList from "./PlatformList";
import VideoUpload from "./VideoUpload";
import DescriptionEditor from "./DescriptionEditor";

const ClipsGenie = () => {
  return (
    <PlatformProvider>
      <div className="flex flex-col md:flex-row gap-6 p-16">
        <PlatformList />
        <div className="md:w-3/4 bg-white dark:bg-[#292c35] shadow-md rounded-lg p-6">
          <VideoUpload />
          <DescriptionEditor />
        </div>
      </div>
    </PlatformProvider>
  );
};

export default ClipsGenie;
