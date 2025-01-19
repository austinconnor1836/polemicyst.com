import React, { useState } from 'react';
import { TextField, Button, List, ListItem, ListItemText, CircularProgress } from '@mui/material';
import axios from 'axios';
import OpenAI from "openai";
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
      const openai = new OpenAI();

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
            {
              role: "user",
              content: "Write a haiku about recursion in programming.",
            },
        ],
      });

      console.log(completion.choices[0].message);
      const responseMsg = completion.choices[0].message;
      // const response = await axios.post(gptApiRoute, { message: input });
      // const assistantMessage: Message = { role: 'assistant', content: response.data.message };
      if (responseMsg) {
        const assistantMessage: Message = { role: 'assistant', content: responseMsg?.content?.toString() ?? '' };
        setMessages([...messages, userMessage, assistantMessage]);
      }
    } catch (error) {
      console.error('Error fetching ChatGPT response:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    // <div className="max-w-xl h-screen flex flex-col">
    <div className="h-screen flex flex-col">
      {/* View window (80% of the height) */}
      <div className="flex-grow overflow-auto">
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
        {loading && <CircularProgress />}
      </div>

      {/* Input and button (20% of the height) */}
      {/* <div className="h-1/5 flex space-x-2 p-4"> */}
      <div className="h-1/5 w-4/5 flex mx-auto space-x-2">
        <TextField
        className="flex-grow w-4/5"
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
          className='mt-2'
          onClick={handleSendMessage}
          variant="contained"
          // fullWidth
          size='medium'
          // disabled={loading}
        >
          Send
        </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatGPT;
