// /app/_components/chatbot.tsx
'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ChatBotProps {
  id: number;
  onClose: (id: number) => void;
}

const ChatBot: React.FC<ChatBotProps> = ({ id, onClose }) => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  const handleSendMessage = () => {
    if (message.trim()) {
      setMessages((prevMessages) => [...prevMessages, message]);
      setMessage('');
    }
  };

  return (
    <Card className="fixed bottom-0 right-0 m-4 w-80 shadow-lg">
      <div className="flex items-center justify-between rounded-t-lg bg-blue-600 p-2 text-white">
        <h3 className="text-lg font-semibold">ChatBot #{id}</h3>
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => onClose(id)}>
          Close
        </Button>
      </div>
      <CardContent className="h-64 overflow-y-auto p-4">
        {messages.map((msg, index) => (
          <div key={index} className="mb-2 p-2 bg-gray-100 rounded-lg">
            {msg}
          </div>
        ))}
      </CardContent>
      <div className="flex items-center gap-2 border-t border-gray-200 p-2 dark:border-zinc-800">
        <Input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
        />
        <Button
          onClick={handleSendMessage}
          className="bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-500 dark:text-white dark:hover:bg-blue-600"
        >
          Send
        </Button>
      </div>
    </Card>
  );
};

export default ChatBot;
