import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

const ADJECTIVES = [
  'Autumn',
  'Silver',
  'Crimson',
  'Golden',
  'Velvet',
  'Amber',
  'Cobalt',
  'Ivory',
  'Scarlet',
  'Onyx',
  'Jade',
  'Coral',
  'Ember',
  'Sapphire',
  'Lunar',
  'Solar',
  'Arctic',
  'Neon',
  'Rustic',
  'Iron',
  'Copper',
  'Crystal',
  'Midnight',
  'Storm',
  'Dusk',
  'Dawn',
  'Frosty',
  'Wild',
  'Silent',
  'Bold',
  'Vivid',
  'Mossy',
  'Prism',
  'Slate',
  'Thistle',
  'Wren',
  'Flint',
  'Cedar',
  'Birch',
  'Ashen',
];

const NOUNS = [
  'Rain',
  'Echo',
  'Drift',
  'Spark',
  'Wave',
  'Bloom',
  'Flare',
  'Pulse',
  'Tide',
  'Ridge',
  'Glow',
  'Shade',
  'Peak',
  'Stone',
  'Blaze',
  'Frost',
  'Reef',
  'Mist',
  'Vine',
  'Dune',
  'Brook',
  'Trail',
  'Crest',
  'Haven',
  'Cliff',
  'Grove',
  'Ember',
  'Haze',
  'Vale',
  'Fern',
  'Lark',
  'Canyon',
  'Plume',
  'Orbit',
  'Rune',
  'Arc',
  'Glen',
  'Wisp',
  'Forge',
  'Spire',
];

function generateTitle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const compositions = await prisma.composition.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
      },
    });

    return NextResponse.json(compositions);
  } catch (err) {
    console.error('[GET /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to load compositions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      title,
      mode,
      audioMode,
      creatorVolume,
      referenceVolume,
      creatorS3Key,
      creatorS3Url,
      creatorDurationS,
    } = body;

    const composition = await prisma.composition.create({
      data: {
        userId: user.id,
        title: title || generateTitle(),
        mode: mode || 'pre-synced',
        audioMode: audioMode || 'both',
        creatorVolume: creatorVolume ?? 1.0,
        referenceVolume: referenceVolume ?? 1.0,
        creatorS3Key: creatorS3Key || null,
        creatorS3Url: creatorS3Url || null,
        creatorDurationS: creatorDurationS || null,
      },
      include: {
        tracks: true,
        outputs: true,
      },
    });

    return NextResponse.json(composition, { status: 201 });
  } catch (err) {
    console.error('[POST /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to create composition' }, { status: 500 });
  }
}
