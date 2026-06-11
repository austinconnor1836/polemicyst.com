import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applyLimit, createLimiter, getClientIp } from '@/lib/rate-limit';

const AUTH_ALLOWLIST_ENABLED = process.env.AUTH_ALLOWLIST_ENABLED === 'true';
const AUTH_ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function isAllowedEmail(email?: string | null): boolean {
  if (!AUTH_ALLOWLIST_ENABLED) return true;
  if (!email || AUTH_ALLOWED_EMAILS.length === 0) return false;
  return AUTH_ALLOWED_EMAILS.includes(email.toLowerCase());
}

// Rate limiters — module-scoped so memory-mode buckets persist across requests.
const mobileAuthLimiter = createLimiter({
  tokens: 10,
  window: '1 m',
  prefix: 'rl:mobile-auth',
});
const healthLimiter = createLimiter({
  tokens: 60,
  window: '1 m',
  prefix: 'rl:health',
});

const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/privacy-policy',
  '/privacy',
  '/terms-of-service',
  '/support',
];

const PUBLIC_PATH_PREFIXES = ['/posts'];

// Build a base URL from forwarded headers (Tailscale serve) or fall back to req.url
function getBaseUrl(req: NextRequest): string {
  const fwdHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!fwdHost) return req.url;

  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const isLocal =
    fwdHost.startsWith('localhost') ||
    fwdHost.startsWith('127.0.0.1') ||
    fwdHost.startsWith('0.0.0.0');

  if (isLocal) {
    // Use the host header directly (preserves port) — avoids req.url's 0.0.0.0
    // binding address which breaks cookies set on localhost
    return `${proto}://${fwdHost}`;
  }

  // For remote hosts (Tailscale etc), strip port (serve listens on 443)
  const cleanHost = fwdHost.replace(/:\d+$/, '');
  return `${proto}://${cleanHost}`;
}

export async function middleware(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  const pathname = req.nextUrl.pathname;

  // ---------------------------------------------------------------------------
  // Rate limiting for unauthenticated / public-but-expensive endpoints.
  // These short-circuit and bypass the auth flow below — they're intentionally
  // reachable without a session (health probes, mobile sign-in).
  // ---------------------------------------------------------------------------
  if (pathname === '/api/health') {
    const limited = await applyLimit(req, getClientIp(req), healthLimiter);
    if (limited) return limited;
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/auth/mobile/')) {
    const limited = await applyLimit(req, getClientIp(req), mobileAuthLimiter);
    if (limited) return limited;
    return NextResponse.next();
  }

  // Redirect authenticated users from home to dashboard
  if (pathname === '/') {
    const token = await getToken({ req });
    if (token && isAllowedEmail(token.email)) {
      return NextResponse.redirect(new URL('/connected-accounts', baseUrl));
    }
    return NextResponse.next();
  }

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  const isApiRoute = pathname.startsWith('/api/');

  const token = await getToken({ req });

  if (token) {
    if (!isAllowedEmail(token.email)) {
      if (isApiRoute) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      const url = new URL('/access-denied', baseUrl);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isApiRoute) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const raw = authHeader.slice(7);
      if (raw && process.env.NEXTAUTH_SECRET) {
        try {
          const { decode } = await import('next-auth/jwt');
          const decoded = await decode({ token: raw, secret: process.env.NEXTAUTH_SECRET });
          if (decoded?.email) {
            if (!isAllowedEmail(decoded.email as string)) {
              return NextResponse.json({ error: 'Access denied' }, { status: 403 });
            }
            return NextResponse.next();
          }
        } catch {
          // Invalid token — fall through to 401
        }
      }
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentUrl = new URL(pathname + req.nextUrl.search, baseUrl);
  const signInUrl = new URL('/auth/signin', baseUrl);
  signInUrl.searchParams.set('callbackUrl', currentUrl.toString());
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    // Main matcher — excludes auth/webhook/static plumbing. NextAuth's own
    // /api/auth/* (callback, csrf, etc.) is excluded; `api/auth/mobile/*` is
    // matched explicitly below so rate-limiting can run on it.
    '/((?!api/auth|api/webhooks|api/app/version-check|api/health|auth/signin|access-denied|_next/static|_next/image|assets|favicon).*)',
    // Rate-limited public endpoints — handled at the top of middleware().
    '/api/health',
    '/api/auth/mobile/:path*',
  ],
};
