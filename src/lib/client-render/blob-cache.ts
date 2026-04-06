/**
 * IndexedDB cache for rendered output blobs AND source files (creator/reference).
 * Persists rendered MP4s and input files across page refreshes so users don't lose work.
 *
 * Stores:
 *   output-blobs  — key: `${compositionId}:${layout}` → Blob
 *   creator-files — key: compositionId → CachedCreatorFile
 *   ref-files     — key: `${compositionId}:${trackId}` → CachedRefFile
 */

const DB_NAME = 'polemicyst-render-cache';
const DB_VERSION = 2;
const STORE_OUTPUT = 'output-blobs';
const STORE_CREATOR = 'creator-files';
const STORE_REF = 'ref-files';

export interface CachedCreatorFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  durationS: number;
  width: number;
  height: number;
}

export interface CachedRefFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  trackId: string;
  label: string;
  durationS: number;
  width: number;
  height: number;
  sourceCrop?: { w: number; h: number; x: number; y: number } | null;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      if (oldVersion < 1) {
        db.createObjectStore(STORE_OUTPUT);
      }
      if (oldVersion < 2) {
        db.createObjectStore(STORE_CREATOR);
        db.createObjectStore(STORE_REF);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cacheKey(compositionId: string, layout: string): string {
  return `${compositionId}:${layout}`;
}

// ---------------------------------------------------------------------------
// Output blobs (existing)
// ---------------------------------------------------------------------------

/** Save a rendered blob to IndexedDB. */
export async function saveBlobToCache(
  compositionId: string,
  layout: string,
  blob: Blob
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OUTPUT, 'readwrite');
    tx.objectStore(STORE_OUTPUT).put(blob, cacheKey(compositionId, layout));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to save:', err);
  }
}

/** Load all cached blobs for a composition. Returns layout -> Blob map. */
export async function loadBlobsFromCache(
  compositionId: string,
  layouts: string[]
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OUTPUT, 'readonly');
    const store = tx.objectStore(STORE_OUTPUT);

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

/** Remove all cached data for a composition (output blobs + source files). */
export async function clearBlobCache(compositionId: string): Promise<void> {
  try {
    const db = await openDB();
    const stores = [STORE_OUTPUT, STORE_REF];
    const tx = db.transaction(stores, 'readwrite');

    // Clear output blobs by prefix scan
    const outputStore = tx.objectStore(STORE_OUTPUT);
    const outputReq = outputStore.getAllKeys();
    outputReq.onsuccess = () => {
      const prefix = `${compositionId}:`;
      for (const key of outputReq.result) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          outputStore.delete(key);
        }
      }
    };

    // Clear ref files by prefix scan
    const refStore = tx.objectStore(STORE_REF);
    const refReq = refStore.getAllKeys();
    refReq.onsuccess = () => {
      const prefix = `${compositionId}:`;
      for (const key of refReq.result) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          refStore.delete(key);
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Clear creator file in a separate transaction (can't mix all 3 in one if STORE_CREATOR isn't in the first tx's scope cleanly)
    const tx2 = db.transaction(STORE_CREATOR, 'readwrite');
    tx2.objectStore(STORE_CREATOR).delete(compositionId);
    await new Promise<void>((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });

    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to clear:', err);
  }
}

// ---------------------------------------------------------------------------
// Creator files
// ---------------------------------------------------------------------------

/** Save creator file to IndexedDB (fire-and-forget). */
export async function saveCreatorFileToCache(
  compositionId: string,
  file: File,
  meta: { durationS: number; width: number; height: number }
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CREATOR, 'readwrite');
    const entry: CachedCreatorFile = {
      blob: file,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      durationS: meta.durationS,
      width: meta.width,
      height: meta.height,
    };
    tx.objectStore(STORE_CREATOR).put(entry, compositionId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to save creator file:', err);
  }
}

/** Load cached creator file for a composition. */
export async function loadCreatorFileFromCache(
  compositionId: string
): Promise<CachedCreatorFile | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CREATOR, 'readonly');
    const result = await new Promise<CachedCreatorFile | null>((resolve) => {
      const req = tx.objectStore(STORE_CREATOR).get(compositionId);
      req.onsuccess = () => {
        const val = req.result;
        if (val && val.blob instanceof Blob) {
          resolve(val as CachedCreatorFile);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
    db.close();
    return result;
  } catch (err) {
    console.warn('[blob-cache] Failed to load creator file:', err);
    return null;
  }
}

/** Remove cached creator file for a composition. */
export async function clearCreatorFileCache(compositionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_CREATOR, 'readwrite');
    tx.objectStore(STORE_CREATOR).delete(compositionId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to clear creator file:', err);
  }
}

// ---------------------------------------------------------------------------
// Reference files
// ---------------------------------------------------------------------------

/** Save a reference file to IndexedDB (fire-and-forget). */
export async function saveRefFileToCache(
  compositionId: string,
  trackId: string,
  file: File,
  meta: {
    label: string;
    durationS: number;
    width: number;
    height: number;
    sourceCrop?: { w: number; h: number; x: number; y: number } | null;
  }
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REF, 'readwrite');
    const entry: CachedRefFile = {
      blob: file,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      trackId,
      label: meta.label,
      durationS: meta.durationS,
      width: meta.width,
      height: meta.height,
      sourceCrop: meta.sourceCrop ?? undefined,
    };
    tx.objectStore(STORE_REF).put(entry, `${compositionId}:${trackId}`);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to save ref file:', err);
  }
}

/** Load all cached reference files for a composition. Returns trackId -> CachedRefFile map. */
export async function loadRefFilesFromCache(
  compositionId: string
): Promise<Map<string, CachedRefFile>> {
  const result = new Map<string, CachedRefFile>();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REF, 'readonly');
    const store = tx.objectStore(STORE_REF);

    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });

    const prefix = `${compositionId}:`;
    const matchingKeys = keys.filter(
      (k): k is string => typeof k === 'string' && k.startsWith(prefix)
    );

    await Promise.all(
      matchingKeys.map(
        (key) =>
          new Promise<void>((resolve) => {
            const req = store.get(key);
            req.onsuccess = () => {
              const val = req.result;
              if (val && val.blob instanceof Blob) {
                result.set(val.trackId, val as CachedRefFile);
              }
              resolve();
            };
            req.onerror = () => resolve();
          })
      )
    );

    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to load ref files:', err);
  }
  return result;
}

/** Remove a single cached reference file. */
export async function clearRefFileCache(compositionId: string, trackId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REF, 'readwrite');
    tx.objectStore(STORE_REF).delete(`${compositionId}:${trackId}`);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to clear ref file:', err);
  }
}

/** Update just the sourceCrop field on an existing cached reference file. */
export async function updateRefFileCropInCache(
  compositionId: string,
  trackId: string,
  sourceCrop: { w: number; h: number; x: number; y: number } | null
): Promise<void> {
  try {
    const db = await openDB();
    const key = `${compositionId}:${trackId}`;
    const tx = db.transaction(STORE_REF, 'readwrite');
    const store = tx.objectStore(STORE_REF);
    const existing = await new Promise<CachedRefFile | null>((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (existing) {
      existing.sourceCrop = sourceCrop;
      store.put(existing, key);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[blob-cache] Failed to update ref file crop:', err);
  }
}
