import NextAuth from "next-auth";
import Facebook from "next-auth/providers/facebook";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Facebook({
      clientId: process.env.AUTH_FACEBOOK_ID!,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET!,
      authorization: {
        params: {
          scope: "public_profile,email,pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token; // Store accessToken in token
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string; // Add accessToken to session
      return session;
    },
  },
});
