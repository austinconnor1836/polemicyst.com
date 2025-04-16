import { prisma } from '@/src/lib/prisma'; // make sure this points to your Prisma client
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await req.json();
  const {
    fileName,
    videoTitle,
    sharedDescription,
    facebookTemplate,
    instagramTemplate,
    youtubeTemplate,
    blueskyTemplate,
    twitterTemplate
  } = data;

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return new Response("User not found", { status: 404 });
    }

    await prisma.video.create({
      data: {
        userId: user.id,
        fileName,
        videoTitle,
        sharedDescription,
        facebookTemplate,
        instagramTemplate,
        youtubeTemplate,
        blueskyTemplate,
        twitterTemplate,
      }
    });

    return new Response("Saved", { status: 200 });
  } catch (err: any) {
    console.error("Save failed:", err);
    return new Response("Error saving video", { status: 500 });
  }
}
