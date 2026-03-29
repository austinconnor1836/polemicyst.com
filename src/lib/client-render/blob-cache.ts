/**
 * IndexedDB cache for rendered output blobs.
 * Persists rendered MP4s across page refreshes so users don't lose work.
 *
 * Key: `${compositionId}:${layout}` → Blob
 */

const DB_NAME = 'polemicyst-render-cache';
const DB_VERSION = 1;
const STORE_NAME = 'output-blobs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cacheKey(compositionId: string, layout: string): string {
  return `${compositionId}:${layout}`;
}

/** Save a rendered blob to IndexedDB. */
export async function saveBlobToCache(
  compositionId: string,
  layout: string,
  blob: Blob
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, cacheKey(compositionId, layout));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to save:', err);
  }
}

/** Load all cached blobs for a composition. Returns layout → Blob map. */
export async function loadBlobsFromCache(
  compositionId: string,
  layouts: string[]
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    await Promise.all(
      layouts.map(
        (layout) =>
          new Promise<void>((resolve) => {
            const req = store.get(cacheKey(compositionId, layout));
            req.onsuccess = () => {
              if (req.result instanceof Blob) {
                result.set(layout, req.result);
              }
              resolve();
            };
            req.onerror = () => resolve(); // non-fatal
          })
      )
    );

    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to load:', err);
  }
  return result;
}

/** Remove all cached blobs for a composition. */
export async function clearBlobCache(compositionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const prefix = `${compositionId}:`;
      for (const key of req.result) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          store.delete(key);
        }
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to clear:', err);
  }
}
