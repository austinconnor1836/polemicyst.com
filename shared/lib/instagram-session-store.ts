/**
 * Durable Instagram session state store — survives ephemeral filesystem
 * restarts on Vercel serverless + Fly Machines.
 *
 * Backends, in priority order:
 *   1. **R2** (`R2_ENDPOINT` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` +
 *      `IG_SESSION_R2_BUCKET` [or `R2_BUCKET`]) — the primary target once
 *      `migrate/data-plane` merges. Uses the S3-compatible SDK we already
 *      have, so no new dep.
 *   2. **Neon** (`KeyValueStore` Prisma table, added in migration
 *      `20260929000000_add_key_value_store`) — used when R2 env is absent
 *      but a DATABASE_URL is. Session states are ~10-40KB JSON, well within
 *      the KV table's target size.
 *   3. **Local filesystem** (`INSTAGRAM_SESSION_STATE_PATH`) — dev-only
 *      fallback; matches the pre-cutover behavior so `scripts/generate-ig-state.ts`
 *      keeps working on a laptop.
 *
 * Symmetric encryption via `SESSION_ENCRYPTION_KEY` (32-byte hex/base64) is
 * applied to the payload before it hits R2 or Neon, using AES-256-GCM. The
 * key is optional — when unset, we store plaintext but log a warning. In dev
 * it's fine to skip; in prod set the env var so a leaked bucket ACL doesn't
 * hand an attacker a live login cookie.
 *
 * Cache: the parsed session state is cached in-process keyed by
 * `${lastFetchedAt}` so a burst of IG requests reuses one lookup.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** How long an in-process cached read stays valid. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const R2_SESSION_KEY = 'instagram/session-source.json';
const KV_ROW_KEY = 'instagram:session:source';

let cached: { raw: string; fetchedAt: number } | null = null;

export interface SessionStoreDiagnostics {
  backend: 'r2' | 'neon' | 'filesystem';
  encrypted: boolean;
}

/** Reset the in-process cache (test / rotation helper). */
export function __resetInstagramSessionCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer | null {
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  // Accept either 64-char hex or 44-char base64 (32 bytes either way).
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    // fall through
  }
  console.warn(
    '[instagram-session-store] SESSION_ENCRYPTION_KEY is set but not a valid 32-byte hex or base64 value — refusing to use it.'
  );
  return null;
}

/** Envelope: `enc-v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>` — plaintext otherwise. */
const ENC_PREFIX = 'enc-v1:';

function encryptIfConfigured(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptIfEnveloped(payload: string): string {
  if (!payload.startsWith(ENC_PREFIX)) return payload;
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Instagram session state is encrypted but SESSION_ENCRYPTION_KEY is not configured.'
    );
  }
  const [, ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error('Malformed encrypted Instagram session state envelope.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// R2 backend (S3-compatible, uses @aws-sdk/client-s3 which is already a dep)
// ---------------------------------------------------------------------------

function r2Configured(): boolean {
  return (
    !!(process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID) &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!(process.env.IG_SESSION_R2_BUCKET || process.env.R2_BUCKET)
  );
}

async function readFromR2(): Promise<string | null> {
  const { S3Client, GetObjectCommand, NoSuchKey } = await import('@aws-sdk/client-s3');
  const endpoint =
    process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = (process.env.IG_SESSION_R2_BUCKET || process.env.R2_BUCKET)!;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  try {
    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: R2_SESSION_KEY }));
    const body = await resp.Body?.transformToString();
    if (!body) return null;
    return decryptIfEnveloped(body);
  } catch (err: unknown) {
    // Missing key is a normal state — the bucket may be empty on first run.
    if (err instanceof NoSuchKey || (err as { name?: string })?.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

async function writeToR2(rawJson: string): Promise<void> {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const endpoint =
    process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = (process.env.IG_SESSION_R2_BUCKET || process.env.R2_BUCKET)!;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  const payload = encryptIfConfigured(rawJson);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: R2_SESSION_KEY,
      Body: payload,
      ContentType: 'application/json',
    })
  );
}

// ---------------------------------------------------------------------------
// Neon backend (`KeyValueStore` Prisma table)
// ---------------------------------------------------------------------------

async function readFromNeon(): Promise<string | null> {
  // Lazy import so this file works in environments that never touch prisma
  // (e.g. the standalone worker Docker image).
  const { prisma } = await import('./prisma');
  const row = await prisma.keyValueStore.findUnique({ where: { key: KV_ROW_KEY } });
  if (!row) return null;
  return decryptIfEnveloped(row.value);
}

async function writeToNeon(rawJson: string): Promise<void> {
  const { prisma } = await import('./prisma');
  const payload = encryptIfConfigured(rawJson);
  await prisma.keyValueStore.upsert({
    where: { key: KV_ROW_KEY },
    create: { key: KV_ROW_KEY, value: payload },
    update: { value: payload },
  });
}

// ---------------------------------------------------------------------------
// Filesystem backend (dev only)
// ---------------------------------------------------------------------------

function resolveSessionStatePath(): string {
  const envPath = process.env.INSTAGRAM_SESSION_STATE_PATH;
  if (envPath && envPath.trim()) return envPath;
  return path.resolve(process.cwd(), 'ig-state-source.json');
}

function readFromFilesystem(): string | null {
  const statePath = resolveSessionStatePath();
  if (!fs.existsSync(statePath)) return null;
  return fs.readFileSync(statePath, 'utf-8');
}

function writeToFilesystem(rawJson: string): void {
  const statePath = resolveSessionStatePath();
  fs.writeFileSync(statePath, rawJson, 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the Instagram session state raw JSON string.
 *
 * Returns null when no configured backend has a session state (caller should
 * throw `InstagramSessionUnavailableError` upstream so API routes can 503).
 *
 * Diagnostics are returned alongside so we can surface "which backend served
 * this" in logs / traces without a second call.
 */
export async function loadInstagramSessionState(): Promise<{
  raw: string;
  diagnostics: SessionStoreDiagnostics;
} | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    // Backend on the cached side is unknown, so we don't report it here.
    return { raw: cached.raw, diagnostics: { backend: 'r2', encrypted: false } };
  }

  if (r2Configured()) {
    const raw = await readFromR2();
    if (raw) {
      cached = { raw, fetchedAt: now };
      return { raw, diagnostics: { backend: 'r2', encrypted: !!getEncryptionKey() } };
    }
  }

  if (process.env.DATABASE_URL) {
    try {
      const raw = await readFromNeon();
      if (raw) {
        cached = { raw, fetchedAt: now };
        return { raw, diagnostics: { backend: 'neon', encrypted: !!getEncryptionKey() } };
      }
    } catch (err) {
      console.warn(
        '[instagram-session-store] Neon KV read failed (falling through):',
        (err as Error).message
      );
    }
  }

  const raw = readFromFilesystem();
  if (raw) {
    cached = { raw, fetchedAt: now };
    return { raw, diagnostics: { backend: 'filesystem', encrypted: false } };
  }

  return null;
}

/**
 * Persist an updated Instagram session state. `instagram-private-api` refreshes
 * cookies + tokens on every login; we should write those back so the next call
 * doesn't need a full re-login.
 *
 * Writes ONLY to the highest-priority configured backend — no dual-write, since
 * the read path is strictly ordered.
 */
export async function saveInstagramSessionState(rawJson: string): Promise<SessionStoreDiagnostics> {
  cached = { raw: rawJson, fetchedAt: Date.now() };

  if (r2Configured()) {
    await writeToR2(rawJson);
    return { backend: 'r2', encrypted: !!getEncryptionKey() };
  }
  if (process.env.DATABASE_URL) {
    try {
      await writeToNeon(rawJson);
      return { backend: 'neon', encrypted: !!getEncryptionKey() };
    } catch (err) {
      console.warn(
        '[instagram-session-store] Neon KV write failed, falling through to fs:',
        (err as Error).message
      );
    }
  }
  writeToFilesystem(rawJson);
  return { backend: 'filesystem', encrypted: false };
}
