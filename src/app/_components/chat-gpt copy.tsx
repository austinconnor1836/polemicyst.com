// components/ChatGPT.tsx
import React, { useState } from 'react';
import { TextField, Button, List, ListItem, ListItemText, CircularProgress } from '@mui/material';
import axios from 'axios';
import { ApiRoutes, buildApiRoute } from '@/lib/api-routes';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatGPT: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages([...messages, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const gptApiRoute = buildApiRoute(ApiRoutes.CHAT_GPT);
    //   const response = await axios.post('/api/chat', { message: input });
      const response = await axios.post(gptApiRoute, { message: input });
      const assistantMessage: Message = { role: 'assistant', content: response.data.message };
      setMessages([...messages, userMessage, assistantMessage]);
    } catch (error) {
      console.error('Error fetching ChatGPT response:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    // <div className="max-w-xl mx-auto pb-20">
    <div className="max-w-xl flex flex-col">
    {/* <div className="h-4/5 overflow-auto"> */}
    <List>
      {messages.map((msg, index) => (
        <ListItem key={index}>
          <ListItemText
            primary={msg.content}
            className={msg.role === 'user' ? 'text-right' : 'text-left'}
          />
        </ListItem>
      ))}
    </List>
    {/* </div> */}

    {loading && <CircularProgress />}

    {/* <div className="fixed bottom-10 left-0 right-0 bg-white p-4 shadow-md"> */}
    {/* <div className="absolute bottom-10 shadow-md flex space-x-2"> */}
      <div className="bottom-10">
      <TextField
        className="bg-transparent flex-grow w-4/5"
        label="Type a message"
        fullWidth
        variant="outlined"
        value={input}
        onChange={handleInputChange}
        onKeyPress={(event) => {
          if (event.key === 'Enter') {
            handleSendMessage();
          }
        }}
        disabled={loading}
      />
      <div className='w-1/5'>
      <Button
        onClick={handleSendMessage}
        variant="contained"
        fullWidth
        disabled={loading}
      >
        Send
      </Button>
      </div>
    </div>
  </div>
    // <div style={{ maxWidth: '600px', margin: '0 auto' }}>
    // <div className={`max-w-xl mx-auto pb-20`}>
    //   <List>
    //     {messages.map((msg, index) => (
    //       <ListItem key={index}>
    //         <ListItemText
    //           primary={msg.content}
    //           style={{ textAlign: msg.role === 'user' ? 'right' : 'left' }}
    //         />
    //       </ListItem>
    //     ))}
    //   </List>

    //   {loading && <CircularProgress />}

    //   <TextField
    //     label="Type a message"
    //     fullWidth
    //     variant="outlined"
    //     value={input}
    //     onChange={handleInputChange}
    //     onKeyPress={(event) => {
    //       if (event.key === 'Enter') {
    //         handleSendMessage();
    //       }
    //     }}
    //     disabled={loading}
    //   />
    //   <Button
    //     onClick={handleSendMessage}
    //     variant="contained"
    //     fullWidth
    //     style={{ marginTop: '10px' }}
    //     disabled={loading}
    //   >
    //     Send
    //   </Button>
    // </div>
  );
};

export default ChatGPT;
