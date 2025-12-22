'use client';

import React from 'react';
import { PlatformProvider } from './PlatformContext';
import { Toaster } from 'react-hot-toast';
import PlatformList from './PlatformList';
import VideoUpload from './VideoUpload';
import DescriptionEditor from './DescriptionEditor';
import Header from './Header';
import PlatformStatusBar from './PlatformStatusBar';
import VideoGrid from './VideoGrid';
import VideoEditorModal from './VideoEditorModal';
import PublishSelectedButton from './PublishSelectedButton';
import { Card, CardContent } from '@/components/ui/card';

const ClipsGenie = () => {
  return (
    <PlatformProvider>
      <div className="px-8 py-16 max-w-screen-lg mx-auto">
        <Toaster position="top-right" />

        {/* Row Layout for Sidebar + Main Controls */}
        <div className="flex flex-col md:flex-row gap-6">
          <PlatformList />
          <Card className="md:w-3/4 shadow-md">
            <CardContent className="p-6">
              <Header />
              <VideoUpload />
              <DescriptionEditor />
            </CardContent>
          </Card>
        </div>
        {/* Grid goes underneath */}
        <VideoGrid />
        <PublishSelectedButton />
        <VideoEditorModal />
      </div>
    </PlatformProvider>
  );
};

export default ClipsGenie;
