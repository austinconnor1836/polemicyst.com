import React, { useState } from 'react';
import axios from 'axios';

const GPTComponent: React.FC = () => {
  const [input, setInput] = useState<string>('');
  const [response, setResponse] = useState<string>('');

  const handleSubmit = async () => {
    try {
      const res = await axios.post('/api/gpt', { prompt: input });
      setResponse(res.data.text);
    } catch (error) {
      console.error('Error fetching GPT response:', error);
      setResponse('Error fetching GPT response');
    }
  };

  return (
    <div>
      <h1>Ask GPT</h1>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type your prompt here..."
      />
      <button onClick={handleSubmit}>Submit</button>
      <div>
        <h2>Response</h2>
        <p>{response}</p>
      </div>
    </div>
  );
};

export default GPTComponent;
