// /src/app/api/videos/[id]/route.ts
import { prisma } from "@/src/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const video = await prisma.video.findUnique({
    where: { id: params.id },
  });

  if (!video) {
    return new Response("Video not found", { status: 404 });
  }

  return Response.json(video);
}
