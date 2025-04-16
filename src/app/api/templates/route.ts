import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/src/lib/prisma";
import { NextRequest } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { templatePreferences: true },
  });

  if (!user?.templatePreferences) {
    // Create default preferences if not set
    const preferences = await prisma.templatePreferences.create({
      data: {
        userId: user.id,
        facebookTemplate: "For more from Polemicyst...",
        instagramTemplate: "For more from Polemicyst...",
        youtubeTemplate: "For more from Polemicyst...",
      },
    });
    return Response.json(preferences);
  }

  return Response.json(user.templatePreferences);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return new Response("User not found", { status: 404 });

  const updated = await prisma.templatePreferences.upsert({
    where: { userId: user.id },
    update: {
      facebookTemplate: body.facebookTemplate,
      instagramTemplate: body.instagramTemplate,
      youtubeTemplate: body.youtubeTemplate,
    },
    create: {
      userId: user.id,
      facebookTemplate: body.facebookTemplate,
      instagramTemplate: body.instagramTemplate,
      youtubeTemplate: body.youtubeTemplate,
    },
  });

  return Response.json(updated);
}
