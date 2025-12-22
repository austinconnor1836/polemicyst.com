'use client';

import React from 'react';
import { PlatformProvider, usePlatformContext } from './PlatformContext';
import { Toaster } from 'react-hot-toast';
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
        <Toaster position="top-right" />
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
