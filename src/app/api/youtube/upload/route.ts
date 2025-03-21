import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const accessToken = formData.get("accessToken") as string; // YouTube OAuth Token

    console.log('file', file);
    if (!file || !title || !description || !accessToken) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    console.log("📺 Uploading to YouTube...");

    // Initialize YouTube API client
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({ version: "v3", auth });

    // Convert File to Stream
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileStream = new Readable();
    fileStream.push(fileBuffer);
    fileStream.push(null);

    // Upload video
    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
          categoryId: "25", // 25 = News & Politics
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fileStream,
      },
    });

    const videoId = response.data.id;
    const youtubeLink = `https://youtu.be/${videoId}`;

    console.log(`✅ YouTube upload successful! Video Link: ${youtubeLink}`);

    return NextResponse.json({ message: "YouTube upload successful!", youtubeLink }, { status: 200 });
  } catch (error: any) {
    console.error("❌ Error uploading to YouTube:", error.response?.data || error.message);
    return NextResponse.json({ error: "Failed to upload video to YouTube" }, { status: 500 });
  }
}
