import { prisma } from './prisma';

/**
 * Get a valid Google access token for a user, refreshing if expired.
 * Works outside NextAuth session context (e.g., in poller workers).
 */
export async function getValidGoogleToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
  });

  if (!account?.access_token) return null;

  // Check if token is still valid (with 60s buffer)
  const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;
  if (expiresAt > Date.now() + 60_000) {
    return account.access_token;
  }

  // Token expired — try to refresh
  if (!account.refresh_token) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[google-token] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return null;
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[google-token] Refresh failed:', res.status, body);
      return null;
    }

    const data = await res.json();

    const newAccessToken: string = data.access_token;
    const newRefreshToken: string = data.refresh_token ?? account.refresh_token;
    const newExpiresAt = Math.floor(Date.now() / 1000) + (data.expires_in as number);

    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
      },
    });

    return newAccessToken;
  } catch (err) {
    console.error('[google-token] Error refreshing token:', err);
    return null;
  }
}
