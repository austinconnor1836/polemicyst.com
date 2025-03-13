import NextAuth, { NextAuthOptions } from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import { NextRequest } from "next/server";

export const authOptions: NextAuthOptions = {
  providers: [
    FacebookProvider({
      clientId: process.env.FACEBOOK_CLIENT_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
};

// const handler = NextAuth(authOptions);

// export { handler as GET, handler as POST };

const handler = NextAuth(authOptions);

// ✅ Export API route handlers for Next.js App Router
export async function GET(req: NextRequest) {
  return handler(req as any, {} as any);
}

export async function POST(req: NextRequest) {
  return handler(req as any, {} as any);
}
