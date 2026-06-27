import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

// Dev-only ring buffer for iOS Stitch render failures. The phone POSTs the full
// failure context here; Claude `cat`s the file to see what the alert says without
// the user having to retype. Disabled when NODE_ENV !== 'development'.

const LOG_FILE = path.join(process.cwd(), 'tmp', 'stitch-debug.log');
const MAX_ENTRIES = 200;

async function ensureDir() {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
}

async function readEntries(): Promise<string[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    return raw.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }
  const ts = new Date().toISOString();
  const entry = JSON.stringify({ ts, ...((payload as object) ?? {}) });
  await ensureDir();
  // APPEND — rewriting the entire file with writeFile() replaces the inode every POST,
  // which makes `tail -F` re-emit the whole history each time. Append-only writes are
  // tail-friendly AND atomic-enough for a debug log (no concurrent writer fighting us).
  await fs.appendFile(LOG_FILE, entry + '\n', 'utf8');
  // Periodically trim the file. Skip on most writes (cheap path). Trim only when the
  // file gets noticeably large so we keep MAX_ENTRIES bound without rewriting every time.
  try {
    const stat = await fs.stat(LOG_FILE);
    if (stat.size > 2_000_000) {
      const entries = await readEntries();
      if (entries.length > MAX_ENTRIES) {
        const trimmed = entries.slice(-MAX_ENTRIES);
        await fs.writeFile(LOG_FILE, trimmed.join('\n') + '\n', 'utf8');
      }
    }
  } catch {
    // best-effort trim, ignore
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const url = new URL(req.url);
  const tail = Number(url.searchParams.get('tail') ?? '20');
  const entries = await readEntries();
  const slice = entries.slice(Math.max(0, entries.length - tail));
  return NextResponse.json({ entries: slice }, { status: 200 });
}

export async function DELETE() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  await ensureDir();
  await fs.writeFile(LOG_FILE, '', 'utf8');
  return NextResponse.json({ ok: true }, { status: 200 });
}
