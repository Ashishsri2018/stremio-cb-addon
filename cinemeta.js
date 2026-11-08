const config = require('./config');

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fromCinemeta(imdbId, type) {
  const data = await fetchJson(`${config.cinemetaUrl}/meta/${type}/${imdbId}.json`);
  const id = data && data.meta && data.meta.moviedb_id;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

async function fromTmdb(imdbId, type) {
  if (!config.tmdbApiKey) return null;
  const resultKey = type === 'series' ? 'tv_results' : 'movie_results';
  const data = await fetchJson(
    `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${encodeURIComponent(config.tmdbApiKey)}`
  );
  const hit = Array.isArray(data[resultKey]) ? data[resultKey][0] : null;
  return hit && Number.isFinite(Number(hit.id)) ? Number(hit.id) : null;
}

async function resolveTmdbId(imdbId, type) {
  const key = `${type}:${imdbId}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = null;
  try {
    value = await fromCinemeta(imdbId, type);
  } catch (err) {
    console.warn(`[cinemeta] ${imdbId}: ${err.message}`);
  }
  if (!value) {
    try {
      value = await fromTmdb(imdbId, type);
    } catch (err) {
      console.warn(`[tmdb] ${imdbId}: ${err.message}`);
    }
  }

  cache.set(key, { value, expires: Date.now() + (value ? CACHE_TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}

module.exports = { resolveTmdbId };
