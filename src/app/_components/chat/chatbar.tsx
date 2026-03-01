// /app/_components/chatbar.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface ChatBarProps {
  openChats: number[];
  onSelectChat: (id: number) => void;
}

const ChatBar: React.FC<ChatBarProps> = ({ openChats, onSelectChat }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white p-2 flex justify-center space-x-4">
      {openChats.map((chatId) => (
        <Button
          key={chatId}
          onClick={() => onSelectChat(chatId)}
          size="sm"
          className="rounded-full bg-blue-500 px-3 py-1 text-white hover:bg-blue-600"
        >
          Chat #{chatId}
        </Button>
      ))}
    </div>
  );
};

export default ChatBar;
