import { prisma } from "@shared/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../auth";
import { NextRequest, NextResponse } from "next/server";
import AWS from "aws-sdk";

const S3_BUCKET = process.env.S3_BUCKET || "clips-genie-uploads";
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const clip = await prisma.video.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, s3Key: true },
  });
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Best-effort S3 delete (DB delete still proceeds if S3 key is missing).
  if (clip.s3Key) {
    try {
      await s3
        .deleteObject({
          Bucket: S3_BUCKET,
          Key: clip.s3Key,
        })
        .promise();
    } catch (err) {
      console.error("Failed to delete clip from S3:", err);
    }
  }

  await prisma.video.delete({
    where: { id: clip.id },
  });

  return NextResponse.json({ ok: true });
}


