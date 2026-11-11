function createLru({ maxEntries = 500, now = Date.now } = {}) {
  const limit =
    Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 0;
  const entries = new Map();
  const stats = { hits: 0, misses: 0, sets: 0, expired: 0, evictions: 0 };

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt != null && entry.expiresAt <= now()) {
      entries.delete(key);
      stats.expired += 1;
      stats.misses += 1;
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    stats.hits += 1;
    return entry.value;
  }

  function set(key, value, expiresAt = null) {
    if (limit === 0) return;
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { value, expiresAt });
    stats.sets += 1;
    while (entries.size > limit) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
      stats.evictions += 1;
    }
  }

  function remove(key) {
    return entries.delete(key);
  }

  function clear() {
    entries.clear();
  }

  function snapshot() {
    return { ...stats, size: entries.size, maxEntries: limit };
  }

  return { get, set, delete: remove, clear, size: () => entries.size, stats: snapshot };
}

module.exports = { createLru };
