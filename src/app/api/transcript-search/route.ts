import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';
import {
  compileQuery,
  scanTranscript,
  youtubeDeepLink,
  type TranscriptHit,
} from '@shared/lib/transcript-search';

// Guardrails against pathological queries + huge catalogs. See spec: cap
// scanned videos + segments so a single POST can't OOM the request worker.
const MAX_VIDEOS_SCANNED = 50;
const MAX_SEGMENTS_SCANNED = 5000;
const MAX_QUERY_LEN = 200;

interface ApiHit {
  hitId: string;
  feedVideoId: string;
  videoTitle: string;
  channel: string | null;
  thumbnailUrl: string | null;
  youtubeVideoId: string | null;
  startSec: number;
  endSec: number | null;
  matchText: string;
  matchedSpan: string;
  deepLinkUrl: string | null;
}

interface GroupedVideo {
  feedVideoId: string;
  videoTitle: string;
  channel: string | null;
  thumbnailUrl: string | null;
  youtubeVideoId: string | null;
  hits: ApiHit[];
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return badRequest('Body must be JSON');
    }

    const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
    if (!rawQuery) return badRequest('Missing query');
    if (rawQuery.length > MAX_QUERY_LEN) {
      return badRequest(`Query too long (max ${MAX_QUERY_LEN} chars)`);
    }
    const wordBoundary = body.wordBoundary === true;

    const compiled = compileQuery(rawQuery, wordBoundary);

    // Upsert the search-query row so re-running the same phrase reuses it.
    // Composite (userId, queryText, wordBoundary) isn't a unique constraint —
    // Prisma won't upsert on non-unique, so do it in two steps.
    let query = await prisma.transcriptSearchQuery.findFirst({
      where: { userId: user.id, queryText: rawQuery, wordBoundary },
    });
    if (!query) {
      query = await prisma.transcriptSearchQuery.create({
        data: {
          userId: user.id,
          queryText: rawQuery,
          wordBoundary,
          isRegex: compiled.isRegex,
        },
      });
    } else {
      query = await prisma.transcriptSearchQuery.update({
        where: { id: query.id },
        data: { lastRunAt: new Date(), isRegex: compiled.isRegex },
      });
    }

    // Load the user's transcribed videos. `orderBy createdAt desc` so newest
    // catalog entries are scanned first (matters when we hit the cap).
    const feedVideos = await prisma.feedVideo.findMany({
      where: { userId: user.id, transcriptJson: { not: undefined } },
      orderBy: { createdAt: 'desc' },
      take: MAX_VIDEOS_SCANNED,
      include: { feed: { select: { youtubeChannelTitle: true, name: true } } },
    });

    let scannedSegments = 0;
    let truncated = false;
    const grouped = new Map<string, GroupedVideo>();
    // Hit rows we intend to persist. Deduped by (feedVideoId, startSec) to
    // satisfy the unique constraint per query.
    type PendingHit = TranscriptHit & { feedVideoId: string };
    const pending: PendingHit[] = [];

    for (const fv of feedVideos) {
      const segs = Array.isArray(fv.transcriptJson) ? (fv.transcriptJson as any[]) : [];
      if (!segs.length) continue;

      // Cap total segments scanned. Slice so we still scan a prefix rather
      // than skipping the whole video.
      const remaining = MAX_SEGMENTS_SCANNED - scannedSegments;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const slice = segs.length > remaining ? segs.slice(0, remaining) : segs;
      if (segs.length > remaining) truncated = true;
      scannedSegments += slice.length;

      const hits = scanTranscript(slice, compiled);
      if (!hits.length) continue;

      for (const h of hits) {
        pending.push({ ...h, feedVideoId: fv.id });
      }

      const channel = fv.feed?.youtubeChannelTitle || fv.feed?.name || null;
      const youtubeVideoId =
        fv.videoId && /^[a-zA-Z0-9_-]{11}$/.test(fv.videoId) ? fv.videoId : null;
      grouped.set(fv.id, {
        feedVideoId: fv.id,
        videoTitle: fv.title,
        channel,
        thumbnailUrl: fv.thumbnailUrl,
        youtubeVideoId,
        hits: hits
          .map(
            (h): ApiHit => ({
              hitId: '', // filled after DB persist
              feedVideoId: fv.id,
              videoTitle: fv.title,
              channel,
              thumbnailUrl: fv.thumbnailUrl,
              youtubeVideoId,
              startSec: h.startSec,
              endSec: h.endSec,
              matchText: h.matchText,
              matchedSpan: h.matchedSpan,
              deepLinkUrl: youtubeVideoId ? youtubeDeepLink(youtubeVideoId, h.startSec) : null,
            })
          )
          .sort((a, b) => a.startSec - b.startSec),
      });
    }

    // Persist hits. `skipDuplicates` handles the unique (queryId, feedVideoId,
    // startSec) collision when the same phrase gets re-run.
    if (pending.length) {
      await prisma.transcriptSearchHit.createMany({
        data: pending.map((p) => ({
          queryId: query!.id,
          feedVideoId: p.feedVideoId,
          startSec: p.startSec,
          endSec: p.endSec,
          matchText: p.matchText,
          matchedSpan: p.matchedSpan,
        })),
        skipDuplicates: true,
      });
    }

    // Fetch the persisted hit rows so we can attach real `hitId`s (needed for
    // the "Generate clip here" button). Sorted the same way as the response.
    const persisted = await prisma.transcriptSearchHit.findMany({
      where: { queryId: query.id },
      orderBy: [{ feedVideoId: 'asc' }, { startSec: 'asc' }],
    });
    const idByKey = new Map<string, string>();
    for (const row of persisted) {
      idByKey.set(`${row.feedVideoId}::${row.startSec}`, row.id);
    }

    const videos: GroupedVideo[] = [];
    for (const g of grouped.values()) {
      g.hits = g.hits.map((h) => ({
        ...h,
        hitId: idByKey.get(`${h.feedVideoId}::${h.startSec}`) ?? '',
      }));
      videos.push(g);
    }

    return ok({
      query: {
        id: query.id,
        queryText: query.queryText,
        wordBoundary: query.wordBoundary,
        isRegex: query.isRegex,
      },
      videos,
      totalHits: pending.length,
      scannedVideos: feedVideos.length,
      scannedSegments,
      truncated,
    });
  } catch (err) {
    return serverError('Transcript search failed', err);
  }
}
