import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const blueskySignIn = async (identifier: string, password: string) => {
  const response = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Bluesky authentication failed.");
  }

  // Store Bluesky tokens in the database
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "bluesky",
        providerAccountId: identifier, // Bluesky username/email
      },
    },
    update: {
      access_token: data.accessJwt,
      refresh_token: data.refreshJwt,
      expires_at: Math.floor(Date.now() / 1000) + 86400, // 24-hour expiry
    },
    create: {
      userId: "some-user-id", // Associate this with an actual user ID
      provider: "bluesky",
      providerAccountId: identifier,
      access_token: data.accessJwt,
      refresh_token: data.refreshJwt,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      type: "credentials",
    },
  });

  return data.accessJwt;
};
