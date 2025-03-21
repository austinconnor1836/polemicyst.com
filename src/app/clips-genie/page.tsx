"use client";

import React from "react";
import { PlatformProvider, usePlatformContext } from "./PlatformContext";
import { Toaster } from "react-hot-toast";
import PlatformList from "./PlatformList";
import VideoUpload from "./VideoUpload";
import DescriptionEditor from "./DescriptionEditor";
import Header from "./Header";

const ClipsGenie = () => {
  return (
    <PlatformProvider>
      <div className="flex flex-col md:flex-row gap-6 p-16">
        <Toaster position="top-right" />
        <PlatformList />
        <div className="md:w-3/4 bg-white dark:bg-[#292c35] shadow-md rounded-lg p-6">
          <Header />
          <VideoUpload />
          <DescriptionEditor />
        </div>
      </div>
    </PlatformProvider>
  );
};

export default ClipsGenie;
