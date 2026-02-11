// middleware.ts
import { withAuth } from 'next-auth/middleware';

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

export const middleware = withAuth({
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    authorized: ({ token }) => {
      if (!token) return false;
      return isAllowedEmail(token.email);
    },
  },
});

export const config = {
  matcher: ['/((?!api/auth|auth/signin|_next/static|_next/image|favicon.ico).*)'],
};
