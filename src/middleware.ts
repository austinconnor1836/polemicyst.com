import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  if (
    fwdHost &&
    !fwdHost.startsWith('localhost') &&
    !fwdHost.startsWith('127.0.0.1') &&
    !fwdHost.startsWith('0.0.0.0')
  ) {
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const cleanHost = fwdHost.replace(/:\d+$/, '');
    return `${proto}://${cleanHost}`;
  }
  return req.url;
}

export async function middleware(req: NextRequest) {
  const baseUrl = getBaseUrl(req);

  // Redirect authenticated users from home to dashboard
  if (req.nextUrl.pathname === '/') {
    const token = await getToken({ req });
    if (token && isAllowedEmail(token.email)) {
      return NextResponse.redirect(new URL('/connected-accounts', baseUrl));
    }
    return NextResponse.next();
  }

  if (
    PUBLIC_PATHS.includes(req.nextUrl.pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => req.nextUrl.pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  const isApiRoute = req.nextUrl.pathname.startsWith('/api/');

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

  const currentUrl = new URL(req.nextUrl.pathname + req.nextUrl.search, baseUrl);
  const signInUrl = new URL('/auth/signin', baseUrl);
  signInUrl.searchParams.set('callbackUrl', currentUrl.toString());
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks|api/app/version-check|api/health|auth/signin|access-denied|_next/static|_next/image|assets|favicon).*)',
  ],
};
