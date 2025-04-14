// /src/app/api/generateDescription/route.ts
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File;

  const buffer = Buffer.from(await file.arrayBuffer());
  const blob = new Blob([buffer], { type: file.type });

  const proxyFormData = new FormData();
  proxyFormData.set('file', blob, file.name);

  const backendRes = await fetch("http://localhost:3001/api/generate", {
    method: "POST",
    body: proxyFormData,
  });

  const raw = await backendRes.text();

  return new Response(raw, {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
