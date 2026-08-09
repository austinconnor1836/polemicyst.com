/**
 * Minimal Node http server exposing `POST /render` and `GET /health`.
 *
 * This is the portable, zero-framework entrypoint. For Vercel/Cloudflare, wrap
 * `handleRender` from `handler.ts` in the platform's request adapter instead —
 * the core is framework-agnostic (see README).
 */

import { createServer } from 'node:http';
import { handleRender, type RenderRequestBody } from './handler';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 1_000_000; // 1 MB — text-only payload

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(json);
  };

  if (req.method === 'GET' && req.url === '/health') {
    return send(200, { ok: true });
  }

  if (req.method !== 'POST' || req.url !== '/render') {
    return send(404, { error: 'Not found' });
  }

  let parsed: RenderRequestBody;
  try {
    const raw = await readBody(req);
    parsed = raw ? (JSON.parse(raw) as RenderRequestBody) : {};
  } catch (err) {
    return send(400, { error: err instanceof Error ? err.message : 'Invalid JSON' });
  }

  const secret = req.headers['x-render-secret'];
  const result = await handleRender(parsed, Array.isArray(secret) ? secret[0] : secret);
  return send(result.status, result.body);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`polemicyst-graphic-render listening on :${PORT}`);
});
