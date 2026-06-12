import { headers } from 'next/headers';
import type { Metadata } from 'next';
import StatusLive, { type HealthSnapshot } from './_components/status-live';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Live operational status of the Clipfire API, queues, and object storage.',
};

async function fetchInitialHealth(): Promise<{
  data: HealthSnapshot | null;
  error: string | null;
}> {
  try {
    const h = await headers();
    const host = h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    if (!host) {
      return { data: null, error: 'Missing host header' };
    }
    const url = `${proto}://${host}/api/health`;
    const res = await fetch(url, { cache: 'no-store' });
    // 200 (ok) and 503 (degraded) both have JSON bodies — accept both.
    const json = (await res.json()) as HealthSnapshot;
    return { data: json, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export default async function StatusPage() {
  const { data, error } = await fetchInitialHealth();

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <h1 className="sr-only">System status</h1>
      <StatusLive initial={data} initialError={error} />
    </div>
  );
}
