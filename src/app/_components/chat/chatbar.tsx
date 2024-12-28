// /app/_components/chatbar.tsx
'use client';

import React from 'react';

interface ChatBarProps {
  openChats: number[];
  onSelectChat: (id: number) => void;
}

const ChatBar: React.FC<ChatBarProps> = ({ openChats, onSelectChat }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white p-2 flex justify-center space-x-4">
      {openChats.map((chatId) => (
        <button
          key={chatId}
          onClick={() => onSelectChat(chatId)}
          className="bg-blue-500 px-3 py-1 rounded-full hover:bg-blue-600 transition"
        >
          Chat #{chatId}
        </button>
      ))}
    </div>
  );
};

export default ChatBar;
