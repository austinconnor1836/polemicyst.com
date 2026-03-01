import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface VersionConfig {
  version: string;
  android: { minVersion: string };
  ios: { minVersion: string };
}

function parseVersion(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0);
}

function isVersionBelow(current: string, minimum: string): boolean {
  const cur = parseVersion(current);
  const min = parseVersion(minimum);
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return true;
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return false;
  }
  return false;
}

let cachedConfig: VersionConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

function loadVersionConfig(): VersionConfig {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const filePath = path.resolve(process.cwd(), 'version.json');
  let fileConfig: VersionConfig = {
    version: '1.0.0',
    android: { minVersion: '1.0.0' },
    ios: { minVersion: '1.0.0' },
  };

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch {
    // version.json may not be bundled in standalone mode
  }

  cachedConfig = {
    version: fileConfig.version,
    android: {
      minVersion: process.env.MIN_APP_VERSION_ANDROID || fileConfig.android?.minVersion || '1.0.0',
    },
    ios: {
      minVersion: process.env.MIN_APP_VERSION_IOS || fileConfig.ios?.minVersion || '1.0.0',
    },
  };
  cachedAt = now;
  return cachedConfig;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const currentVersion = searchParams.get('currentVersion');

  if (!platform || !currentVersion) {
    return NextResponse.json(
      { error: 'Missing required query params: platform, currentVersion' },
      { status: 400 }
    );
  }

  if (platform !== 'android' && platform !== 'ios') {
    return NextResponse.json({ error: 'platform must be "android" or "ios"' }, { status: 400 });
  }

  const config = loadVersionConfig();
  const minVersion = config[platform].minVersion;
  const updateRequired = isVersionBelow(currentVersion, minVersion);

  const storeUrl =
    platform === 'android'
      ? 'https://play.google.com/store/apps/details?id=com.polemicyst.android'
      : 'https://apps.apple.com/app/polemicyst/id0000000000';

  return NextResponse.json({
    updateRequired,
    minimumVersion: minVersion,
    latestVersion: config.version,
    storeUrl,
  });
}
