const { createLru } = require('./lru');

function createStreamCache({
  ttlMs = 180000,
  partialTtlMs = 30000,
  maxEntries = 500,
  now = Date.now,
} = {}) {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 0;
  const partialTtl =
    Number.isFinite(partialTtlMs) && partialTtlMs > 0
      ? Math.floor(partialTtlMs)
      : 0;
  const lru = createLru({ maxEntries, now });
  const enabled = ttl > 0 && lru.stats().maxEntries > 0;
  const inFlight = new Map();
  let coalesced = 0;
  let sets = 0;

  async function getOrLoad(key, loader) {
    if (enabled) {
      const hit = lru.get(key);
      if (hit !== undefined) return hit;
    }

    const pending = inFlight.get(key);
    if (pending) {
      coalesced += 1;
      return pending;
    }

    const promise = Promise.resolve()
      .then(loader)
      .then((result) => {
        const value = Array.isArray(result) ? result : result?.value;
        const partial = !Array.isArray(result) && result?.partial === true;
        if (enabled && Array.isArray(value) && value.length > 0) {
          const entryTtl = partial ? Math.min(ttl, partialTtl) : ttl;
          if (entryTtl > 0) {
            lru.set(key, value, now() + entryTtl);
            sets += 1;
          }
        }
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  function stats() {
    const current = lru.stats();
    return {
      enabled,
      hits: current.hits,
      misses: current.misses,
      coalesced,
      sets,
      evictions: current.evictions,
      expired: current.expired,
      size: current.size,
      maxEntries: current.maxEntries,
      ttlMs: ttl,
      partialTtlMs: partialTtl,
    };
  }

  return { getOrLoad, size: () => lru.size(), stats };
}

module.exports = { createStreamCache };
