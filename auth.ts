import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import TwitterProvider from "next-auth/providers/twitter";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { BskyAgent } from "@atproto/api";
import { JWT } from "next-auth/jwt";
import axios from "axios";

interface ExtendedJWT extends JWT {
  googleAccessToken?: string;
  googleRefreshToken?: string;
  accessTokenExpires?: number;
  id?: string;
}

const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma), // PostgreSQL persistence
  debug: true,
  providers: [
    FacebookProvider({
      clientId: process.env.AUTH_FACEBOOK_ID!,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET!,
      authorization: {
        params: {
          scope: "public_profile,email,pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video",
        },
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/youtube.upload",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    CredentialsProvider({
      name: "Bluesky",
      credentials: {
        username: { label: "Bluesky Handle or Email", type: "text" },
        password: { label: "App Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing Bluesky credentials.");
        }

        try {
          const agent = new BskyAgent({ service: "https://bsky.social" });
          const session = await agent.login({
            identifier: credentials.username,
            password: credentials.password,
          });

          // Find or create user in PostgreSQL
          let user = await prisma.user.findFirst({
            where: { email: credentials.username },
          });

          if (!user) {
            user = await prisma.user.create({
              data: {
                email: credentials.username,
                name: credentials.username,
              },
            });
          }

          // Store Bluesky session tokens and DID in the database
          await prisma.account.upsert({
            where: {
              provider_providerAccountId: {
                provider: "bluesky",
                providerAccountId: credentials.username,
              },
            },
            update: {
              access_token: session.data.accessJwt,
              refresh_token: session.data.refreshJwt,
              expires_at: Math.floor(Date.now() / 1000) + 86400,
              scope: session.data.did, // ✅ Store DID here
            },
            create: {
              userId: user.id,
              provider: "bluesky",
              providerAccountId: credentials.username,
              access_token: session.data.accessJwt,
              refresh_token: session.data.refreshJwt,
              expires_at: Math.floor(Date.now() / 1000) + 86400,
              type: "credentials",
              scope: session.data.did, // ✅ Store DID here
            },
          });

          return user;
        } catch (error) {
          console.error("Bluesky authentication error:", error);
          throw new Error("Invalid Bluesky credentials.");
        }
      },
    }),
    TwitterProvider({
      clientId: process.env.TWITTER_CONSUMER_KEY!,
      clientSecret: process.env.TWITTER_CONSUMER_SECRET!,
      version: "2.0",
      authorization: {
        url: "https://twitter.com/i/oauth2/authorize",
        params: {
          scope: "tweet.read tweet.write users.read offline.access",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: '/auth/signin'
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }

      if (account?.provider === "google") {
        return {
          ...token,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at! * 1000,
        };
      }

      // if (account?.provider === "google" && account.access_token) {
      //   token.googleAccessToken = account.access_token as string;
      // }

      if (account?.provider === "facebook" && account.access_token) {
        token.facebookAccessToken = account.access_token as string;
      }

      // Return token if access token is still valid
      if (
        token.googleAccessToken &&
        typeof token.accessTokenExpires === "number" &&
        Date.now() < token.accessTokenExpires
      ) {
        return token;
      }

      // return token;

      // Access token expired, try to refresh it
      return await refreshAccessToken(token);
    },
    async signIn({ user, account }) {
      if (!user.email || !account) return false;

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (existingUser) {
        await prisma.account.upsert({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          update: {
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            scope: account.scope,
            token_type: account.token_type,
          },
          create: {
            userId: existingUser.id,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            type: account.type,
            scope: account.scope,
            token_type: account.token_type,
          },
        });
      }

      return true;
    },
    async session({ session, token }) {
      if (token) {
        session.user = { ...session.user, id: token.sub as string };
      }

      if (token.googleAccessToken) {
        session.user.googleAccessToken = token.googleAccessToken;
      }

      if (token.facebookAccessToken) {
        session.user.facebookAccessToken = token.facebookAccessToken;
      }

      const accounts = await prisma.account.findMany({
        where: { userId: session.user.id },
        select: { provider: true },
      });

      let providers = accounts.map((acc: any) => acc.provider);

      if (providers.includes("facebook") && !providers.includes("instagram")) {
        providers.push("instagram");
      }

      session.user.providers = providers;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };



async function refreshAccessToken(token: ExtendedJWT): Promise<ExtendedJWT> {
  try {
    const params = new URLSearchParams();
    params.append("client_id", process.env.GOOGLE_CLIENT_ID!);
    params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET!);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", token.googleRefreshToken!); // Now safe

    const response = await axios.post("https://oauth2.googleapis.com/token", params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const refreshedTokens = response.data;

    const newAccessToken = refreshedTokens.access_token;
    const newRefreshToken = refreshedTokens.refresh_token ?? token.googleRefreshToken;
    const newExpiresAt = Date.now() + refreshedTokens.expires_in * 1000;

    await prisma.account.updateMany({
      where: {
        provider: "google",
        userId: token.sub,
      },
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: Math.floor(newExpiresAt / 1000),
      },
    });

    return {
      ...token,
      googleAccessToken: newAccessToken,
      googleRefreshToken: newRefreshToken,
      accessTokenExpires: newExpiresAt,
    };
  } catch (error: any) {
    console.error("Error refreshing Google access token", error.response?.data || error.message);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}



