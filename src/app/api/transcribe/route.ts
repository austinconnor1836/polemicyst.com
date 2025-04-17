// /src/app/api/transcribe/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/src/lib/prisma";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const videoId = formData.get("videoId") as string;

  if (!file || !videoId) {
    return new Response("Missing file or videoId", { status: 400 });
  }

  try {
    // Prepare the file for proxying to the backend
    const buffer = Buffer.from(await file.arrayBuffer());
    const blob = new Blob([buffer], { type: file.type });

    const proxyFormData = new FormData();
    proxyFormData.set("file", blob, file.name);

    // Send the file to the backend transcription endpoint
    const transcribeRes = await fetch("http://localhost:3001/api/transcribe", {
      method: "POST",
      body: proxyFormData,
    });

    const text = await transcribeRes.text();

    if (!transcribeRes.ok) {
      console.error("Transcription failed:", text);
      return new Response("Transcription error", { status: 500 });
    }

    let transcript = "";
    try {
      const json = JSON.parse(text);
      transcript = json.transcript;
    } catch (e) {
      console.error("Failed to parse transcription response:", text);
      return new Response("Bad transcription response", { status: 500 });
    }

    // Save the transcript to the DB
    await prisma.video.update({
      where: { id: videoId },
      data: { transcript },
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("Error transcribing video:", err);
    return new Response("Failed to transcribe video", { status: 500 });
  }
}
