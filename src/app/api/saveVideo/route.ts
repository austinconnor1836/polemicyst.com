import { NextRequest } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { randomUUID } from "crypto";
import AWS from "aws-sdk";

const S3_BUCKET = "clips-genie-uploads";
const S3_REGION = process.env.S3_REGION!;
const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  signatureVersion: "v4",
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const videoTitle = formData.get("videoTitle") as string;
  const fileName = formData.get("fileName") as string;

  if (!file || !videoTitle || !fileName) {
    return new Response("Missing fields", { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { templatePreferences: true },
  });

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  const preferences = user.templatePreferences;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const key = `video-uploads/${randomUUID()}-${fileName}`;

  await s3
    .upload({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
    .promise();

  const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

  const newVideo = await prisma.video.create({
    data: {
      userId: user.id,
      fileName,
      s3Key: key,
      s3Url,
      videoTitle,
      sharedDescription: "",
      facebookTemplate: preferences?.facebookTemplate || "",
      instagramTemplate: preferences?.instagramTemplate || "",
      youtubeTemplate: preferences?.youtubeTemplate || "",
      blueskyTemplate: "",
      twitterTemplate: "",
    },
  });

  return Response.json({ videoId: newVideo.id, s3Url });
}
