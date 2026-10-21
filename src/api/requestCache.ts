type GetCacheEntry = {
  promise: Promise<unknown>;
  expiresAt: number | null;
};

const getCache = new Map<string, GetCacheEntry>();

export function cachedGet<T>(
  key: string,
  load: () => Promise<T>,
  cacheDurationMs = 0,
): Promise<T> {
  const current = getCache.get(key);
  if (current && (current.expiresAt === null || current.expiresAt > Date.now())) {
    return current.promise as Promise<T>;
  }

  const entry: GetCacheEntry = {
    promise: Promise.resolve().then(load),
    expiresAt: null,
  };
  getCache.set(key, entry);

  void entry.promise.then(
    () => {
      if (getCache.get(key) !== entry) return;
      if (cacheDurationMs > 0) {
        entry.expiresAt = Date.now() + cacheDurationMs;
      } else {
        getCache.delete(key);
      }
    },
    () => {
      if (getCache.get(key) === entry) getCache.delete(key);
    },
  );

  return entry.promise as Promise<T>;
}

export function invalidateCachedGets(...keyPrefixes: string[]) {
  if (keyPrefixes.length === 0) {
    getCache.clear();
    return;
  }

  for (const key of getCache.keys()) {
    if (keyPrefixes.some((prefix) => key.startsWith(prefix))) {
      getCache.delete(key);
    }
  }
}
