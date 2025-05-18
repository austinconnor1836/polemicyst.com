import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
import { PrismaClient } from "@prisma/client";
import AWS from "aws-sdk";

const prisma = new PrismaClient();

const S3_BUCKET = "clips-genie-uploads";
const S3_REGION = process.env.S3_REGION;

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});

export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Only JSON requests are supported" }, { status: 400 });
  }

  try {
    const { videoId, title, description, userId } = await req.json();

    if (!videoId || !title || !description || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video || !video.s3Key) {
      return NextResponse.json({ error: "Video not found or missing s3Key" }, { status: 404 });
    }

    const googleAccount = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });

    const accessToken = googleAccount?.access_token;
    if (!accessToken) {
      return NextResponse.json({ error: "Google account not connected" }, { status: 403 });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({ version: "v3", auth });

    const s3Res = await s3.getObject({ Bucket: S3_BUCKET, Key: video.s3Key }).promise();
    if (!s3Res.Body) {
      return NextResponse.json({ error: "S3 file not found" }, { status: 404 });
    }

    const fileStream = new Readable();
    fileStream.push(s3Res.Body as Buffer);
    fileStream.push(null);

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title, description, categoryId: "25" },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      },
      media: { body: fileStream },
    });

    const youtubeId = response.data.id;
    const youtubeLink = `https://youtu.be/${youtubeId}`;

    return NextResponse.json({ youtubeLink }, { status: 200 });

  } catch (err: any) {
    console.error("YouTube upload error:", err.response?.data || err.message || err);
    return NextResponse.json({ error: "Failed to upload to YouTube" }, { status: 500 });
  }
}
