import NextAuth from 'next-auth/next';
import type { NextAuthOptions, Session, User } from 'next-auth';
import type { Account } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import FacebookProvider from 'next-auth/providers/facebook';
import GoogleProvider from 'next-auth/providers/google';
import TwitterProvider from 'next-auth/providers/twitter';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { BskyAgent } from '@atproto/api';
import type { JWT } from 'next-auth/jwt';
import axios from 'axios';
import { cookies } from 'next/headers';
import { prisma } from '@shared/lib/prisma';
import { flushServerPostHog, getServerPostHog } from '@/lib/posthog';

/**
 * COPPA defense (W008): the sign-in page sets a short-lived `clipfire_age_gate=1`
 * cookie when the user ticks the "I am 13 or older" checkbox. The NextAuth signIn
 * callback consults it to (a) reject new signups missing consent and (b) stamp
 * `User.acceptedAgeGate=true` so we have a per-user audit trail. Existing users
 * with `acceptedAgeGate=null` are grandfathered.
 */
async function hasAgeGateConsent(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get('clipfire_age_gate')?.value === '1';
  } catch {
    return false;
  }
}

interface ExtendedJWT extends JWT {
  googleAccessToken?: string;
  googleRefreshToken?: string;
  accessTokenExpires?: number;
  id?: string;
  sub?: string;
  error?: string;
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
          // COPPA defense (W008): refuse to create a new dev user without consent.
          if (!(await hasAgeGateConsent())) return null;
          user = await prisma.user.create({
            data: { email, name: email.split('@')[0], acceptedAgeGate: true },
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
    error(code: string, metadata: unknown) {
      console.error(`[next-auth][error][${code}]`, redactSecrets(metadata));
    },
    warn(code: string) {
      console.warn(`[next-auth][warn][${code}]`);
    },
    debug(code: string, metadata: unknown) {
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
          scope:
            'openid email profile https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
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
            // COPPA defense (W008): refuse to create a new Bluesky user without consent.
            if (!(await hasAgeGateConsent())) {
              throw new Error('Age confirmation required to create an account.');
            }
            user = await prisma.user.create({
              data: {
                email: credentials.username,
                name: credentials.username,
                acceptedAgeGate: true,
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
    async jwt({ token, user, account }: { token: any; user?: any; account?: any }) {
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
    async signIn({ user, account }: { user: any; account: any }) {
      if (!user.email || !account) return false;
      if (IS_DEV && account.provider === 'dev') return isAllowedEmail(user.email);
      if (!isAllowedEmail(user.email) || !isAllowedProvider(account.provider)) return false;

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      // COPPA defense (W008): block new signups without the age-gate consent cookie.
      // Existing users skip the check (grandfathered).
      const ageGateOk = await hasAgeGateConsent();
      if (!existingUser && !ageGateOk) {
        return false;
      }

      if (existingUser) {
        // Backfill consent on existing users who tick the box on a later sign-in.
        if (ageGateOk && existingUser.acceptedAgeGate !== true) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { acceptedAgeGate: true },
          });
        }
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
    async session({ session, token }: { session: any; token: any }) {
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
  events: {
    // COPPA defense (W008): when the PrismaAdapter (OAuth flow) creates a brand-new
    // User row, stamp `acceptedAgeGate=true` if the sign-in cookie is present. The
    // `signIn` callback already blocks creation when consent is absent, so reaching
    // here implies the user ticked the box.
    async createUser({ user }: { user: any }) {
      if (await hasAgeGateConsent()) {
        await prisma.user.update({
          where: { id: user.id },
          data: { acceptedAgeGate: true },
        });
      }

      // W013: fire signup conversion event. No-op when POSTHOG_API_KEY is unset.
      const posthog = getServerPostHog();
      if (posthog && user?.id) {
        try {
          // Best-effort provider detection — the PrismaAdapter `createUser`
          // event doesn't surface the provider directly, but for any
          // non-credentials sign-in (the only path that creates DB users in
          // prod) the most recent Account row holds it.
          let provider: string | undefined;
          try {
            const account = await prisma.account.findFirst({
              where: { userId: user.id },
              orderBy: { id: 'desc' },
              select: { provider: true },
            });
            provider = account?.provider ?? undefined;
          } catch {
            // Best-effort — fall through with provider undefined.
          }

          posthog.capture({
            distinctId: user.id,
            event: 'signup',
            properties: {
              provider: provider ?? 'unknown',
              email: user.email ?? undefined,
            },
          });
          await flushServerPostHog();
        } catch {
          // Non-fatal — analytics must never break sign-up.
        }
      }
    },
  },
};

const nextAuthHandler = NextAuth(authOptions);

// Dynamically set NEXTAUTH_URL from the request Host header so OAuth
// callbacks work for both localhost and Tailscale without restarts.
function withDynamicUrl(handler: typeof nextAuthHandler) {
  return async (req: Request, ctx: any) => {
    const fwdHost = req.headers.get('x-forwarded-host');
    const host = fwdHost || req.headers.get('host');
    if (host) {
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      // Strip port for non-localhost hosts — Tailscale serve listens on 443
      // but forwards :3000 in the Host header
      const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
      const cleanHost = isLocalhost ? host : host.replace(/:\d+$/, '');
      process.env.NEXTAUTH_URL = `${proto}://${cleanHost}`;
    }
    return handler(req, ctx);
  };
}

export const GET = withDynamicUrl(nextAuthHandler);
export const POST = withDynamicUrl(nextAuthHandler);

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
