// /app/_components/splitview-buttons.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface SplitViewButtonProps {
  onToggleSplitView: () => void;
}

const SplitViewButton: React.FC<SplitViewButtonProps> = ({ onToggleSplitView }) => {
  return (
    <Button
      onClick={onToggleSplitView}
      className="fixed right-4 top-4 bg-green-600 text-white shadow-md hover:bg-green-700 dark:bg-green-600 dark:text-white dark:hover:bg-green-700"
    >
      Open Split View
    </Button>
  );
};

export default SplitViewButton;
