import NextAuth from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    // Facebook (Meta) Provider
    FacebookProvider({
      clientId: process.env.AUTH_FACEBOOK_ID!,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET!,
      authorization: {
        params: {
          scope: "public_profile,email,pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video",
        },
      },
    }),

    // Google (YouTube) Provider
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
  ],

  callbacks: {
    // Store both Facebook and Google access tokens
    async jwt({ token, account, profile }) {
      if (account) {
        if (account.provider === "facebook") {
          token.facebookAccessToken = account.access_token;
        } else if (account.provider === "google") {
          token.googleAccessToken = account.access_token;
        }
      }
      return token;
    },

    // Attach tokens to session for client-side access
    async session({ session, token }) {
      session.facebookAccessToken = token.facebookAccessToken as string | undefined;
      session.googleAccessToken = token.googleAccessToken as string | undefined;
      return session;
    },
  },
});
