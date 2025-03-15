import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    facebookAccessToken?: string;
    googleAccessToken?: string;
  }

  interface JWT {
    accessToken?: string;
  }
}
