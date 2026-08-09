/**
 * Vercel serverless-function adapter for the browserless render service.
 *
 * Thin translation layer between the Vercel Node signature
 * (`export default async function handler(req, res)`) and the
 * framework-agnostic core in `src/handler.ts`. All the real work — secret
 * check, validation, Satori + resvg render, base64 response shape — lives in
 * the shared handler; this file only:
 *   - parses the JSON request body (Vercel usually pre-parses it into
 *     `req.body`; we fall back to reading the raw stream if not),
 *   - reads the `x-render-secret` header,
 *   - answers a GET as a lightweight health check.
 *
 * Routing: `vercel.json` rewrites `/render` -> `/api/render` and
 * `/health` -> `/api/render`, so the public contract stays
 * `POST /render` + `GET /health`.
 */

import { handleRender, type RenderRequestBody } from '../src/handler';

/** Minimal structural shape of a Vercel Node request (subset we use). */
interface Req {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, listener: (arg: unknown) => void): void;
}

/** Minimal structural shape of a Vercel Node response (subset we use). */
interface Res {
  status(code: number): Res;
  json(data: unknown): void;
}

function readRawBody(req: Req): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: unknown) => {
      data += String(chunk);
    });
    req.on('end', () => resolve(data));
    req.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

async function parseBody(req: Req): Promise<RenderRequestBody> {
  const raw = req.body;
  // Vercel auto-parses application/json into an object.
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return raw as RenderRequestBody;
  }
  // Buffer or string body -> parse manually.
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = typeof raw === 'string' ? raw : raw.toString();
    return text ? (JSON.parse(text) as RenderRequestBody) : {};
  }
  // Body not populated (streaming) -> read it ourselves.
  const text = await readRawBody(req);
  return text ? (JSON.parse(text) as RenderRequestBody) : {};
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let body: RenderRequestBody;
  try {
    body = await parseBody(req);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid JSON' });
    return;
  }

  const headerSecret = req.headers['x-render-secret'];
  const secret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;

  const result = await handleRender(body, secret);
  res.status(result.status).json(result.body);
}
