import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/src/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { videos: true },
  });

  return Response.json(user?.videos || []);
}
