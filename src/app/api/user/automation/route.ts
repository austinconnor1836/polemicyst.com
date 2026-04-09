import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { DEFAULT_VIRALITY_SETTINGS, type ViralitySettingsValue } from '@shared/virality';

const VALID_ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];
const VALID_CAPTION_STYLES = ['default', 'bold', 'minimal', 'none'];
const VALID_QUOTE_STYLES = [
  'pull-quote',
  'lower-third',
  'highlight-card',
  'side-panel',
  'typewriter',
];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rule = await prisma.automationRule.findUnique({
    where: { userId: user.id },
  });

  if (!rule) {
    return NextResponse.json({
      enabled: false,
      autoGenerateClips: true,
      viralitySettings: DEFAULT_VIRALITY_SETTINGS,
      captionsEnabled: true,
      captionStyle: 'default',
      aspectRatio: '9:16',
      cropTemplateId: null,
      autoPublish: false,
      publishPlatforms: [],
      quoteGraphicsEnabled: false,
      quoteGraphicStyle: 'pull-quote',
    });
  }

  return NextResponse.json({
    enabled: rule.enabled,
    autoGenerateClips: rule.autoGenerateClips,
    viralitySettings: rule.viralitySettings ?? DEFAULT_VIRALITY_SETTINGS,
    captionsEnabled: rule.captionsEnabled,
    captionStyle: rule.captionStyle,
    aspectRatio: rule.aspectRatio,
    cropTemplateId: rule.cropTemplateId,
    autoPublish: rule.autoPublish,
    publishPlatforms: rule.publishPlatforms ?? [],
    quoteGraphicsEnabled: rule.quoteGraphicsEnabled,
    quoteGraphicStyle: rule.quoteGraphicStyle,
  });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
  const autoGenerateClips =
    typeof body.autoGenerateClips === 'boolean' ? body.autoGenerateClips : undefined;
  const captionsEnabled =
    typeof body.captionsEnabled === 'boolean' ? body.captionsEnabled : undefined;
  const autoPublish = typeof body.autoPublish === 'boolean' ? body.autoPublish : undefined;

  const captionStyle =
    typeof body.captionStyle === 'string' && VALID_CAPTION_STYLES.includes(body.captionStyle)
      ? body.captionStyle
      : undefined;

  const aspectRatio =
    typeof body.aspectRatio === 'string' && VALID_ASPECT_RATIOS.includes(body.aspectRatio)
      ? body.aspectRatio
      : undefined;

  const cropTemplateId =
    body.cropTemplateId === null || typeof body.cropTemplateId === 'string'
      ? (body.cropTemplateId as string | null)
      : undefined;

  const publishPlatforms = Array.isArray(body.publishPlatforms)
    ? body.publishPlatforms.filter((p): p is string => typeof p === 'string')
    : undefined;

  const viralitySettings =
    body.viralitySettings && typeof body.viralitySettings === 'object'
      ? (body.viralitySettings as Partial<ViralitySettingsValue>)
      : undefined;

  const quoteGraphicsEnabled =
    typeof body.quoteGraphicsEnabled === 'boolean' ? body.quoteGraphicsEnabled : undefined;

  const quoteGraphicStyle =
    typeof body.quoteGraphicStyle === 'string' &&
    VALID_QUOTE_STYLES.includes(body.quoteGraphicStyle)
      ? body.quoteGraphicStyle
      : undefined;

  const data: Record<string, unknown> = {};
  if (enabled !== undefined) data.enabled = enabled;
  if (autoGenerateClips !== undefined) data.autoGenerateClips = autoGenerateClips;
  if (captionsEnabled !== undefined) data.captionsEnabled = captionsEnabled;
  if (captionStyle !== undefined) data.captionStyle = captionStyle;
  if (aspectRatio !== undefined) data.aspectRatio = aspectRatio;
  if (cropTemplateId !== undefined) data.cropTemplateId = cropTemplateId;
  if (autoPublish !== undefined) data.autoPublish = autoPublish;
  if (publishPlatforms !== undefined) data.publishPlatforms = publishPlatforms;
  if (viralitySettings !== undefined) data.viralitySettings = viralitySettings;
  if (quoteGraphicsEnabled !== undefined) data.quoteGraphicsEnabled = quoteGraphicsEnabled;
  if (quoteGraphicStyle !== undefined) data.quoteGraphicStyle = quoteGraphicStyle;

  const rule = await prisma.automationRule.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      ...(data as any),
    },
    update: data as any,
  });

  return NextResponse.json({
    enabled: rule.enabled,
    autoGenerateClips: rule.autoGenerateClips,
    viralitySettings: rule.viralitySettings ?? DEFAULT_VIRALITY_SETTINGS,
    captionsEnabled: rule.captionsEnabled,
    captionStyle: rule.captionStyle,
    aspectRatio: rule.aspectRatio,
    cropTemplateId: rule.cropTemplateId,
    autoPublish: rule.autoPublish,
    publishPlatforms: rule.publishPlatforms ?? [],
    quoteGraphicsEnabled: rule.quoteGraphicsEnabled,
    quoteGraphicStyle: rule.quoteGraphicStyle,
  });
}
