import { NextResponse } from 'next/server';
import { BskyAgent } from '@atproto/api';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    const session = await agent.login({ identifier: username, password });

    return NextResponse.json({
      message: 'Login successful!',
      session: session.data, // ✅ Send the full session data
    }, { status: 200 });
  } catch (error) {
    console.error('Bluesky login error:', error);
    return NextResponse.json({ message: 'Login failed. Check credentials.' }, { status: 401 });
  }
}
