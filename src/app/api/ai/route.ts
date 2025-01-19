// src/app/api/ai/route.ts
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import OpenAI from 'openai';

const openai = new OpenAI();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Make sure to set this in your .env.local

export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return NextResponse.json({ message: 'Only POST requests allowed' }, { status: 405 });
  }

  const { message } = await req.json();

  try {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            {
                role: "user",
                content: "Write a haiku about recursion in programming.",
            },
            {
                role: "user",
                content: message
            },
        ],
    });

    console.log(completion.choices[0].message);
    // const response = await axios.post(
    //   'https://api.openai.com/v1/chat/completions',
    //   {
    //     model: 'gpt-4', // Use the GPT model you'd like
    //     messages: [{ role: 'user', content: message }],
    //   },
    //   {
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Authorization: `Bearer ${OPENAI_API_KEY}`,
    //     },
    //   }
    // );

    // const assistantMessage = response.data.choices[0].message.content;
    const assistantMessage = completion.choices[0].message;
    return NextResponse.json({ message: assistantMessage }, { status: 200 });
  } catch (error) {
    console.error('Error fetching from OpenAI API:', error);
    return NextResponse.json({ message: 'Error fetching from OpenAI API' }, { status: 500 });
  }
}