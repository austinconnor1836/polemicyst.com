// /api/meta/upload/instagram/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const S3_BUCKET = "clips-genie-uploads";
const S3_REGION = process.env.S3_REGION;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForInstagramMedia(creationId: string, accessToken: string) {
  let attempts = 0;
  const maxAttempts = 50;
  const waitTime = 5000;

  while (attempts < maxAttempts) {
    await delay(waitTime);
    attempts++;

    try {
      const response = await axios.get(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`
      );
      if (response.data.status_code === "FINISHED") return true;
    } catch {}
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { videoId, description, userId } = await req.json();
    if (!videoId || !description || !userId) {
      return new Response("Missing required fields", { status: 400 });
    }

    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video || !video.s3Key) return new Response("Video not found", { status: 404 });

    const fbAccount = await prisma.account.findFirst({
      where: { userId, provider: "facebook" },
    });
    const userAccessToken = fbAccount?.access_token;

    const { data: pagesData } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );
    const page = pagesData.data[0];
    const pageId = page.id;
    const pageAccessToken = page.access_token;

    const { data: instaData } = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    const instagramAccountId = instaData.instagram_business_account?.id;
    if (!instagramAccountId) {
      return new Response("No Instagram Business Account linked", { status: 400 });
    }

    const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${video.s3Key}`;
    const igUploadResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        media_type: "REELS",
        video_url: s3Url,
        caption: description,
        access_token: pageAccessToken,
      }
    );

    const creationId = igUploadResponse.data.id;
    const isReady = await waitForInstagramMedia(creationId, pageAccessToken);
    if (!isReady) return new Response("Instagram media timeout", { status: 500 });

    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      {
        creation_id: creationId,
        access_token: pageAccessToken,
      }
    );

    return new Response(JSON.stringify({ instagramPostId: publishRes.data.id }), { status: 200 });
  } catch (err: any) {
    console.error("Instagram upload error:", err.response?.data || err.message);
    return new Response("Failed to upload to Instagram", { status: 500 });
  }
}