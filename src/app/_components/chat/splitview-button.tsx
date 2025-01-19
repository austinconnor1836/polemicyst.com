// /app/_components/splitview-buttons.tsx
'use client';

import React from 'react';

interface SplitViewButtonProps {
  onToggleSplitView: () => void;
}

const SplitViewButton: React.FC<SplitViewButtonProps> = ({ onToggleSplitView }) => {
  return (
    <button
      onClick={onToggleSplitView}
      className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-green-600 transition"
    >
      Open Split View
    </button>
  );
};

export default SplitViewButton;