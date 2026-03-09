import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { getValidGoogleToken } from '@shared/lib/google-token';
import { listUserChannels } from '@shared/util/youtube-api';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = await getValidGoogleToken(user.id);
  if (!token) {
    return NextResponse.json(
      { error: 'google_not_connected', message: 'Google account not connected or token expired' },
      { status: 403 }
    );
  }

  try {
    const channels = await listUserChannels(token);
    return NextResponse.json(channels);
  } catch (err: any) {
    console.error('[youtube/channels] Error listing channels:', err.message);

    // Check for insufficient scope
    if (err.code === 403 || err.message?.includes('insufficientPermissions')) {
      return NextResponse.json(
        {
          error: 'insufficient_scope',
          message: 'Please re-authenticate with Google to grant YouTube access',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: 'Failed to list YouTube channels' }, { status: 500 });
  }
}
