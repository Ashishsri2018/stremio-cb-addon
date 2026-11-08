const config = require('./config');
const { providersFor } = require('./providers');
const { resolveTmdbId } = require('./cinemeta');
const { qualityRank, toStremioStream } = require('./format');

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[streams] ${label} timed out after ${ms}ms`);
      resolve([]);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function collectStreams(imdbId, type, season, episode) {
  const deadline = Date.now() + config.deadlineMs;
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const tmdbId = await resolveTmdbId(imdbId, type);
  if (!tmdbId) {
    console.warn(`[streams] no TMDB id resolved for ${imdbId}`);
    return [];
  }

  const timeoutMs = Math.max(1000, Math.min(config.providerTimeoutMs, deadline - Date.now()));
  const providers = providersFor(mediaType);
  const results = await Promise.all(
    providers.map(async (provider) => {
      const started = Date.now();
      try {
        const streams = await withTimeout(
          Promise.resolve().then(() => provider.getStreams(String(tmdbId), mediaType, season, episode)),
          timeoutMs,
          provider.id
        );
        const list = Array.isArray(streams) ? streams : [];
        if (list.length > 0) {
          console.log(`[streams] ${provider.id} -> ${list.length} (${Date.now() - started}ms)`);
        }
        return list
          .map((stream) => toStremioStream(stream, provider))
          .filter(Boolean)
          .map((stream) => ({ stream, provider }));
      } catch (err) {
        console.warn(`[streams] ${provider.id} failed: ${err.message}`);
        return [];
      }
    })
  );

  const seen = new Set();
  const deduped = [];
  for (const list of results) {
    for (const item of list) {
      const key = item.stream.url || `${item.stream.infoHash}:${item.stream.fileIdx || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ ...item, rank: qualityRank(item.stream) });
    }
  }

  deduped.sort((a, b) => a.rank - b.rank || a.provider.order - b.provider.order);
  return deduped.map((item) => item.stream);
}

module.exports = { collectStreams };
