/**
 * Storage factory — picks R2 vs S3 based on env `STORAGE_PROVIDER`.
 *
 * Default is `s3` for backward compatibility. Set `STORAGE_PROVIDER=r2`
 * (or leave unset with any of `R2_ACCOUNT_ID` / `R2_BUCKET` set) to
 * switch to Cloudflare R2.
 *
 * Consumers should import `getStorage()` here rather than instantiating
 * an adapter directly — that way env-based switching stays in one place.
 */

import type { StorageProvider } from './storage-provider';
import { S3StorageAdapter } from './s3-adapter';
import { R2StorageAdapter } from './r2-adapter';

export type StorageProviderKind = 'r2' | 's3';

export function getStorageProviderKind(): StorageProviderKind {
  const raw = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (raw === 'r2') return 'r2';
  if (raw === 's3') return 's3';
  // Auto-detect: if R2 is configured, use it.
  if (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT) return 'r2';
  return 's3';
}

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (cached) return cached;
  const kind = getStorageProviderKind();
  cached = kind === 'r2' ? new R2StorageAdapter() : new S3StorageAdapter();
  return cached;
}

/** Testing helper — clears the cached provider so env changes take effect. */
export function __resetStorage(): void {
  cached = null;
}

export { S3StorageAdapter, R2StorageAdapter };
export type { StorageProvider } from './storage-provider';
