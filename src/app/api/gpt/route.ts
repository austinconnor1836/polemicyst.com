// app/api/gpt/route.ts

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import axios from 'axios';

export async function POST(req: NextRequest) {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return NextResponse.json({ text: 'Missing OpenAI API Key' }, { status: 500 });
  }

  const { prompt } = await req.json();

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/completions',
      {
        model: 'text-davinci-003',
        prompt: prompt,
        max_tokens: 100,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
      }
    );

    const gptResponse = response.data.choices[0].text;
    return NextResponse.json({ text: gptResponse }, { status: 200 });
  } catch (error) {
    console.error('Error fetching GPT response:', error);
    return NextResponse.json({ text: 'Error fetching GPT response' }, { status: 500 });
  }
}
