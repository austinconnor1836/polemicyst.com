import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../../auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const { provider } = await req.json();
  if (!provider) {
    return NextResponse.json({ message: "Provider is required" }, { status: 400 });
  }

  try {
    // ✅ Remove only the selected provider (and Instagram if Facebook is removed)
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: provider === "facebook" ? { in: ["facebook", "instagram"] } : provider,
      },
    });

    // ✅ Fetch remaining providers to ensure session stays updated
    const remainingProviders = await prisma.account.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    });

    return NextResponse.json({
      message: `Logged out from ${provider}`,
      remainingProviders: remainingProviders.map((acc: any) => acc.provider),
    });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ message: "Logout failed" }, { status: 500 });
  }
}
