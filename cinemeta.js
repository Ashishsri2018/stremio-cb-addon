const config = require('./config');
const { createLru } = require('./lib/lru');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function createMetadataResolver({
  cinemetaUrl = config.cinemetaUrl,
  tmdbApiKey = config.tmdbApiKey,
  cacheMaxEntries = config.tmdbCacheMaxEntries,
  now = Date.now,
  fetchJsonFn = fetchJson,
  logger = console,
} = {}) {
  const cache = createLru({ maxEntries: cacheMaxEntries, now });
  const inFlight = new Map();
  const base = String(cinemetaUrl || '').replace(/\/$/, '');

  async function fromCinemeta(imdbId, type) {
    const data = await fetchJsonFn(`${base}/meta/${type}/${imdbId}.json`);
    const id = data && data.meta && data.meta.moviedb_id;
    return Number.isFinite(Number(id)) ? Number(id) : null;
  }

  async function fromTmdb(imdbId, type) {
    if (!tmdbApiKey) return null;
    const resultKey = type === 'series' ? 'tv_results' : 'movie_results';
    const data = await fetchJsonFn(
      `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${encodeURIComponent(tmdbApiKey)}`
    );
    const hit = Array.isArray(data[resultKey]) ? data[resultKey][0] : null;
    return hit && Number.isFinite(Number(hit.id)) ? Number(hit.id) : null;
  }

  function lookup(imdbId, type) {
    const cinemeta = Promise.resolve()
      .then(() => fromCinemeta(imdbId, type))
      .catch((err) => {
        logger.warn(`[cinemeta] ${imdbId}: ${err.message}`);
        return null;
      });

    if (!tmdbApiKey) return cinemeta;

    const tmdb = Promise.resolve()
      .then(() => fromTmdb(imdbId, type))
      .catch((err) => {
        logger.warn(`[tmdb] ${imdbId}: ${err.message}`);
        return null;
      });

    // First non-null source wins; null counts as "no answer", not as a result.
    return Promise.any([
      cinemeta.then((value) => {
        if (value != null) return value;
        throw new Error('cinemeta returned no id');
      }),
      tmdb.then((value) => {
        if (value != null) return value;
        throw new Error('tmdb returned no id');
      }),
    ]).catch(() => null);
  }

  async function resolveTmdbId(imdbId, type) {
    const key = `${type}:${imdbId}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = lookup(imdbId, type)
      .then((value) => {
        cache.set(key, value, now() + (value ? CACHE_TTL_MS : NEGATIVE_TTL_MS));
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  function cacheStats() {
    return cache.stats();
  }

  return { resolveTmdbId, cacheStats };
}

const defaultResolver = createMetadataResolver();

module.exports = {
  createMetadataResolver,
  resolveTmdbId: defaultResolver.resolveTmdbId,
  cacheStats: defaultResolver.cacheStats,
};
