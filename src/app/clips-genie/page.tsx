'use client';

import React from 'react';
import { PlatformProvider, usePlatformContext } from './PlatformContext';
import { ThemedToaster } from '@/components/themed-toaster';
import PlatformList from './PlatformList';
import VideoUpload from './VideoUpload';
import DescriptionEditor from './DescriptionEditor';
import Header from './Header';
import PlatformStatusBar from './PlatformStatusBar';
import { Card, CardContent } from '@/components/ui/card';

const ClipsGenie = () => {
  return (
    <PlatformProvider>
      <div className="flex flex-col md:flex-row gap-6 px-8 py-16 max-w-screen-lg mx-auto">
        <ThemedToaster />
        <PlatformList />
        <Card className="md:w-3/4 shadow-md">
          <CardContent className="p-6">
            <Header />
            <VideoUpload />
            <DescriptionEditor />
          </CardContent>
        </Card>
      </div>
    </PlatformProvider>
  );
};

export default ClipsGenie;
