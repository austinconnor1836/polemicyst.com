import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import { prisma } from "@shared/lib/prisma";

/**
 * Clips are currently stored as `Video` rows.
 * Preferred identification: `sourceVideoId != null` (generated clips referencing a source video).
 * Back-compat: older clips may have `sourceVideoId == null` but use an S3 key suffix `-clip.mp4`.
 */
export async function GET() {
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

  const clips = await prisma.video.findMany({
    where: {
      userId: user.id,
      OR: [
        { sourceVideoId: { not: null } },
        // Legacy heuristic for older clips created before `sourceVideoId` was set.
        {
          AND: [
            { s3Key: { endsWith: "-clip.mp4" } },
            { fileName: "" },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      sourceVideo: {
        select: { id: true, videoTitle: true, s3Url: true },
      },
    },
  });

  return NextResponse.json(clips);
}


