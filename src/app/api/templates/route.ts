import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@shared/lib/prisma";
import { NextRequest } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { templatePreferences: true },
  });

  if (!user) return new Response("User not found", { status: 404 });
  if (!user?.templatePreferences) {
    // Create default preferences if not set
    const preferences = await prisma.templatePreferences.create({
      data: {
        userId: user.id,
        facebookTemplate: "",
        instagramTemplate: "",
        youtubeTemplate: "",
        sharedPostscript: ""
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

  const {
    facebookTemplate,
    instagramTemplate,
    youtubeTemplate,
    sharedPostscript = "", // ✅ provide a fallback if undefined
  } = body;

  const updated = await prisma.templatePreferences.upsert({
    where: { userId: user.id },
    update: {
      facebookTemplate,
      instagramTemplate,
      youtubeTemplate,
      sharedPostscript,
    },
    create: {
      userId: user.id,
      facebookTemplate,
      instagramTemplate,
      youtubeTemplate,
      sharedPostscript,
    },
  });

  return Response.json(updated);
}

