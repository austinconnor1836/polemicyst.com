import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      facebookAccessToken?: string;
      googleAccessToken?: string;
      twitterAccessToken?: string;
      blueskyAccessToken?: string;
      instagramAccessToken?: string;
      providers?: string[];
    };
  }
}


interface JWT {
  accessToken?: string;
}