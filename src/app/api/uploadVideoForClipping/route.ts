// /app/api/uploadVideoForClipping/route.ts
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const TEMP_DIR = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filename = `${randomUUID()}.mp4`;
  const filepath = path.join(TEMP_DIR, filename);

  fs.writeFileSync(filepath, buffer);

  return new Response(JSON.stringify({ filename }), { status: 200 });
}
