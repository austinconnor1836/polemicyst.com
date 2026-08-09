/**
 * Framework-agnostic request handler for `POST /render`.
 *
 * Keeps the HTTP concern (secret check, validation, response shape) separate
 * from the render core so it drops into a Node http server, a Vercel Route
 * Handler, or a Cloudflare Worker with a thin adapter each.
 *
 * Contract:
 *   POST /render
 *   headers: { "x-render-secret": <RENDER_SECRET> }   (enforced iff env set)
 *   body:    { text: string, showPageIndicator?: boolean }
 *   200 ->   { images: string[] /* base64 PNG, one per page * /, pageCount, fontSize }
 *   400 ->   { error }   invalid input
 *   401 ->   { error }   bad/missing shared secret
 *   500 ->   { error }   render failure
 */

import { timingSafeEqual } from 'node:crypto';
import { renderPolemicystGraphic } from './render';

/** Max accepted input length — a hard guard against pathological payloads. */
export const MAX_TEXT_LENGTH = 20_000;

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Validate the shared secret. Returns null when authorised, or a 401 result.
 * If `RENDER_SECRET` is unset in the environment, auth is disabled (dev mode).
 */
export function checkSecret(providedSecret: string | undefined): HandlerResult | null {
  const expected = process.env.RENDER_SECRET;
  if (!expected) return null; // dev: no secret configured
  if (!providedSecret || !safeEqual(providedSecret, expected)) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  return null;
}

export interface RenderRequestBody {
  text?: unknown;
  showPageIndicator?: unknown;
}

/** Validate + coerce the request body. */
export function validateBody(
  body: RenderRequestBody
): { ok: true; text: string; showPageIndicator: boolean } | { ok: false; error: string } {
  if (typeof body?.text !== 'string') {
    return { ok: false, error: 'Field "text" is required and must be a string' };
  }
  const text = body.text;
  if (text.trim().length === 0) {
    return { ok: false, error: 'Field "text" must not be empty' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `Field "text" exceeds ${MAX_TEXT_LENGTH} characters` };
  }
  let showPageIndicator = true;
  if (body.showPageIndicator !== undefined) {
    if (typeof body.showPageIndicator !== 'boolean') {
      return { ok: false, error: 'Field "showPageIndicator" must be a boolean' };
    }
    showPageIndicator = body.showPageIndicator;
  }
  return { ok: true, text, showPageIndicator };
}

/**
 * Full handler: secret check -> validation -> render -> base64 response.
 * `providedSecret` is the value of the `x-render-secret` header.
 */
export async function handleRender(
  body: RenderRequestBody,
  providedSecret: string | undefined
): Promise<HandlerResult> {
  const authFail = checkSecret(providedSecret);
  if (authFail) return authFail;

  const validated = validateBody(body);
  if (!validated.ok) return { status: 400, body: { error: validated.error } };

  try {
    const { buffers, pageCount, fontSize } = await renderPolemicystGraphic({
      text: validated.text,
      showPageIndicator: validated.showPageIndicator,
    });
    return {
      status: 200,
      body: {
        images: buffers.map((b) => b.toString('base64')),
        pageCount,
        fontSize,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Render failed';
    return { status: 500, body: { error: message } };
  }
}
