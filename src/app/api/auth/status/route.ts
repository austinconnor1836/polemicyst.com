import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../auth";

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ isAuthenticated: {} }, { status: 401 });
  }

  try {
    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    });

    // Convert accounts array into an object like { bluesky: true, google: true, ... }
    const isAuthenticated = accounts.reduce((acc, { provider }) => {
      acc[provider] = true;
      return acc;
    }, {} as Record<string, boolean>);

    return NextResponse.json({ isAuthenticated });
  } catch (error) {
    console.error("Error fetching authentication status:", error);
    return NextResponse.json({ isAuthenticated: {} }, { status: 500 });
  }
}
