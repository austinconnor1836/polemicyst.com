import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import FacebookProvider from 'next-auth/providers/facebook';
import GoogleProvider from 'next-auth/providers/google';
import TwitterProvider from 'next-auth/providers/twitter';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { BskyAgent } from '@atproto/api';
import { JWT } from 'next-auth/jwt';
import axios from 'axios';
import { prisma } from '@shared/lib/prisma';

interface ExtendedJWT extends JWT {
  googleAccessToken?: string;
  googleRefreshToken?: string;
  accessTokenExpires?: number;
  id?: string;
}

const NEXTAUTH_DEBUG_ENABLED = process.env.NEXTAUTH_DEBUG === 'true';
const AUTH_ALLOWLIST_ENABLED = process.env.AUTH_ALLOWLIST_ENABLED === 'true';
const AUTH_ALLOWED_EMAILS = parseAllowlist(process.env.AUTH_ALLOWED_EMAILS);
const AUTH_ALLOWED_PROVIDERS = parseAllowlist(process.env.AUTH_ALLOWED_PROVIDERS ?? 'google');

function parseAllowlist(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedEmail(email?: string | null): boolean {
  if (!AUTH_ALLOWLIST_ENABLED) return true;
  if (!email || AUTH_ALLOWED_EMAILS.length === 0) return false;
  return AUTH_ALLOWED_EMAILS.includes(email.toLowerCase());
}

function isAllowedProvider(provider?: string | null): boolean {
  if (!AUTH_ALLOWLIST_ENABLED) return true;
  if (!provider || AUTH_ALLOWED_PROVIDERS.length === 0) return false;
  return AUTH_ALLOWED_PROVIDERS.includes(provider.toLowerCase());
}

function redactSecrets(input: unknown): unknown {
  const seen = new WeakSet<object>();

  const isSensitiveKey = (key: string) =>
    /(secret|token|password|authorization|cookie|pkce|state|clientsecret|refresh_token|access_token|id_token)/i.test(
      key
    );

  const walk = (value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    // Dates / Errors / Buffers etc: return as-is (avoid mangling)
    if (value instanceof Date || value instanceof Error) return value;

    if (seen.has(value as object)) return '[REDACTED_CYCLE]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map(walk);
    }

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      // Common shape in NextAuth debug logs: cookies: [{ name, value, ... }]
      const shouldRedactCookieValue =
        k === 'value' && typeof obj.name === 'string' && /next-auth/i.test(obj.name);

      if (isSensitiveKey(k) || shouldRedactCookieValue) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = walk(v);
      }
    }

    return out;
  };

  return walk(input);
}

const IS_DEV = process.env.NODE_ENV !== 'production';

const devCredentialsProvider = IS_DEV
  ? CredentialsProvider({
      id: 'dev',
      name: 'Dev Login',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const email = credentials.email.trim().toLowerCase();

        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: { email, name: email.split('@')[0] },
          });
        }
        return user;
      },
    })
  : null;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma), // PostgreSQL persistence
  // Never log OAuth tokens / secrets unless explicitly enabled.
  debug: NEXTAUTH_DEBUG_ENABLED,
  logger: {
    error(code, metadata) {
      console.error(`[next-auth][error][${code}]`, redactSecrets(metadata));
    },
    warn(code) {
      console.warn(`[next-auth][warn][${code}]`);
    },
    debug(code, metadata) {
      // NextAuth should only call this when debug=true, but keep it safe anyway.
      if (!NEXTAUTH_DEBUG_ENABLED) return;
      console.debug(`[next-auth][debug][${code}]`, redactSecrets(metadata));
    },
  },
  providers: [
    ...(devCredentialsProvider ? [devCredentialsProvider] : []),
    FacebookProvider({
      clientId: process.env.AUTH_FACEBOOK_ID!,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET!,
      authorization: {
        params: {
          scope:
            'public_profile,email,pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video',
        },
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/youtube.upload',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    CredentialsProvider({
      name: 'Bluesky',
      credentials: {
        username: { label: 'Bluesky Handle or Email', type: 'text' },
        password: { label: 'App Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Missing Bluesky credentials.');
        }

        try {
          const agent = new BskyAgent({ service: 'https://bsky.social' });
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
                provider: 'bluesky',
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
              provider: 'bluesky',
              providerAccountId: credentials.username,
              access_token: session.data.accessJwt,
              refresh_token: session.data.refreshJwt,
              expires_at: Math.floor(Date.now() / 1000) + 86400,
              type: 'credentials',
              scope: session.data.did, // ✅ Store DID here
            },
          });

          return user;
        } catch (error) {
          console.error('Bluesky authentication error:', error);
          throw new Error('Invalid Bluesky credentials.');
        }
      },
    }),
    TwitterProvider({
      clientId: process.env.TWITTER_CONSUMER_KEY!,
      clientSecret: process.env.TWITTER_CONSUMER_SECRET!,
      version: '2.0',
      authorization: {
        url: 'https://twitter.com/i/oauth2/authorize',
        params: {
          scope: 'tweet.read tweet.write users.read offline.access',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }

      if (account?.provider === 'google') {
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

      if (account?.provider === 'facebook' && account.access_token) {
        token.facebookAccessToken = account.access_token as string;
      }

      // Return token if access token is still valid
      if (
        token.googleAccessToken &&
        typeof token.accessTokenExpires === 'number' &&
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
      if (IS_DEV && account.provider === 'dev') return isAllowedEmail(user.email);
      if (!isAllowedEmail(user.email) || !isAllowedProvider(account.provider)) return false;

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

      try {
        const accounts = await prisma.account.findMany({
          where: { userId: session.user.id },
          select: { provider: true },
        });

        let providers = accounts.map((acc: any) => acc.provider);

        if (providers.includes('facebook') && !providers.includes('instagram')) {
          providers.push('instagram');
        }

        session.user.providers = providers;
      } catch (err) {
        console.error('[next-auth][session] Failed to load account providers:', err);
        session.user.providers = [];
      }

      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

async function refreshAccessToken(token: ExtendedJWT): Promise<ExtendedJWT> {
  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID!);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', token.googleRefreshToken!); // Now safe

    const response = await axios.post('https://oauth2.googleapis.com/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const refreshedTokens = response.data;

    const newAccessToken = refreshedTokens.access_token;
    const newRefreshToken = refreshedTokens.refresh_token ?? token.googleRefreshToken;
    const newExpiresAt = Date.now() + refreshedTokens.expires_in * 1000;

    await prisma.account.updateMany({
      where: {
        provider: 'google',
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
    console.error('Error refreshing Google access token', error.response?.data || error.message);
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}
