import { NextRequest } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';
import { renderPolemicystGraphic } from '@shared/util/polemicystGraphic';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * POST /api/polemicyst-graphic/render
 *
 * Body: { text: string, showPageIndicator?: boolean }
 *
 * 100% PROGRAMMATIC — no AI / no LLM. Typesets the pasted `text` into the fixed
 * Polemicyst brand card and rasterizes it to one or more 1080×1350 PNG pages
 * (an Instagram carousel when the text is long), uploads each page to S3, and
 * returns `{ imageUrls }`.
 *
 * SYNCHRONOUS by design. Unlike the Stitch / Split-Frame pipelines (which
 * enqueue a BullMQ job because FFmpeg renders are long-running), this render is
 * a fast Puppeteer HTML→PNG pass with NO model call. Puppeteer already runs in
 * the Next.js web API runtime here — see the established
 * `POST /api/articles/[id]/rasterize-graphics` route, which rasterizes brand
 * graphics the same way and returns inline. Rendering synchronously gives the
 * best UX (the iOS composer shows the result immediately) and needs no queue,
 * worker, DB row, or polling.
 */

/** Guardrail so a runaway paste can't pin the render loop for minutes. */
const MAX_TEXT_LENGTH = 20_000;

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const { text, showPageIndicator } = (body ?? {}) as {
      text?: unknown;
      showPageIndicator?: unknown;
    };

    if (typeof text !== 'string' || text.trim().length === 0) {
      return badRequest('Missing "text" — paste the copy to typeset', {
        code: 'VALIDATION_ERROR',
      });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return badRequest(`Text is too long (${text.length} chars); max ${MAX_TEXT_LENGTH}`, {
        code: 'VALIDATION_ERROR',
      });
    }

    let pngBuffers: Buffer[];
    try {
      pngBuffers = await renderPolemicystGraphic({
        text,
        showPageIndicator: typeof showPageIndicator === 'boolean' ? showPageIndicator : undefined,
      });
    } catch (renderErr) {
      // Empty-after-parse is a client problem; anything else is a render fault.
      const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
      if (msg === 'No text to render') {
        return badRequest('No renderable text after parsing');
      }
      return serverError('Failed to render Polemicyst graphic', renderErr);
    }

    const s3 = makeS3v3Client();
    const batchId = randomUUID();
    const imageUrls: string[] = [];

    for (let i = 0; i < pngBuffers.length; i++) {
      const key = `polemicyst-graphic/${user.id}/${batchId}-${i + 1}.png`;
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: pngBuffers[i],
          ContentType: 'image/png',
        })
      );
      imageUrls.push(`https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`);
    }

    return ok({ imageUrls, pageCount: imageUrls.length });
  } catch (err) {
    return serverError('Failed to render Polemicyst graphic', err);
  }
}
