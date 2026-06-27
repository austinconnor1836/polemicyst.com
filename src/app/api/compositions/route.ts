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

    return NextResponse.json(serializeBigInts(compositions));
  } catch (err) {
    console.error('[GET /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to load compositions' }, { status: 500 });
  }
}

/**
 * Recursively coerces BigInt values to plain JS numbers so `NextResponse.json`
 * (standard `JSON.stringify`) doesn't throw on Prisma `BigInt?` columns —
 * e.g. `CompositionOutput.fileSizeBytes`, which the stitch-render worker stamps
 * once a render completes. Without this guard, any composition with a finished
 * server-side render breaks every list/detail response.
 */
function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return Number(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInts) as unknown as T;
  }
  // Only descend into plain objects — Date / Buffer / etc. have their own JSON
  // representations and recursing through them produces empty `{}` after
  // `Object.entries` enumeration.
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeBigInts(v);
    }
    return out as T;
  }
  return value;
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

    return NextResponse.json(serializeBigInts(composition), { status: 201 });
  } catch (err) {
    console.error('[POST /api/compositions]', err);
    return NextResponse.json({ error: 'Failed to create composition' }, { status: 500 });
  }
}
