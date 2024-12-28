// /app/_components/chatbot.tsx
'use client';

import React, { useState } from 'react';

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
    <div className="fixed bottom-0 right-0 m-4 w-80 bg-white shadow-lg border border-gray-300 rounded-lg">
      <div className="flex justify-between items-center bg-blue-600 text-white p-2 rounded-t-lg">
        <h3 className="text-lg font-semibold">ChatBot #{id}</h3>
        <button onClick={() => onClose(id)} className="text-sm">
          Close
        </button>
      </div>
      <div className="p-4 h-64 overflow-y-auto">
        {messages.map((msg, index) => (
          <div key={index} className="mb-2 p-2 bg-gray-100 rounded-lg">
            {msg}
          </div>
        ))}
      </div>
      <div className="flex items-center p-2 border-t">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-2 py-1 border rounded-lg"
        />
        <button
          onClick={handleSendMessage}
          className="ml-2 px-4 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatBot;
