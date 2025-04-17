// /api/meta/upload/facebook/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import FormData from "form-data";
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

    const s3Stream = s3.getObject({ Bucket: S3_BUCKET, Key: video.s3Key }).createReadStream();

    const fbForm = new FormData();
    fbForm.append("description", description);
    fbForm.append("access_token", pageAccessToken);
    fbForm.append("source", s3Stream, { filename: video.fileName || "video.mp4" });

    const fbRes = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      fbForm,
      { headers: fbForm.getHeaders() }
    );

    return new Response(JSON.stringify({ facebookVideoId: fbRes.data.id }), { status: 200 });
  } catch (err: any) {
    console.error("Facebook upload error:", err.response?.data || err.message);
    return new Response("Failed to upload to Facebook", { status: 500 });
  }
}
