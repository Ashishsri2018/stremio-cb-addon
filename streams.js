const config = require('./config');
const { getRegistry, providersFor } = require('./providers');
const { tmdbIdOf } = require('./content-id');
const cinemeta = require('./cinemeta');
const { isWebPage, qualityRank, toStremioStream } = require('./format');
const {
  DEFAULT_CONFIG,
  normalizeSubtitles,
  streamPassesFilters,
  subtitleMatchesConfig,
} = require('./filters');
const { createBreaker } = require('./lib/breaker');
const { createStreamCache } = require('./lib/stream-cache');
const { TimeoutError, withTimeout } = require('./lib/timeout');

const BLOCKER_URL_PATTERN = /\/slowdown\b/i;

function streamKey(type, contentId, season, episode) {
  return `${type}:${contentId}:${season ?? ''}:${episode ?? ''}`;
}

function validStream(stream) {
  if (!stream) return false;
  const targetUrl = stream.url || stream.externalUrl;
  if (typeof targetUrl === 'string' && targetUrl.length > 0) {
    if (BLOCKER_URL_PATTERN.test(targetUrl)) return false;
    return true;
  }
  return typeof stream.infoHash === 'string' && stream.infoHash.length > 0;
}

function normalizeStreamKey(stream) {
  if (!stream) return '';
  const targetUrl = stream.url || stream.externalUrl;
  if (typeof targetUrl === 'string' && targetUrl.length > 0) {
    try {
      const parsed = new URL(targetUrl);
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
    } catch {
      return targetUrl.replace(/#.*$/, '').replace(/\/+$/, '');
    }
  }
  if (typeof stream.infoHash === 'string' && stream.infoHash.length > 0) {
    return `torrent:${stream.infoHash.toLowerCase()}:${stream.fileIdx || 0}`;
  }
  return '';
}

function dedupe(results) {
  const seen = new Set();
  const deduped = [];

  for (const list of results) {
    for (const item of list) {
      const key = normalizeStreamKey(item.stream);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}

function createCollector({
  providersFor: providersForFn = providersFor,
  getProviders = getRegistry,
  resolveTmdbId = cinemeta.resolveTmdbId,
  getMetadataCacheStats = cinemeta.cacheStats,
  breaker = createBreaker({
    threshold: config.breakerFailureThreshold,
    cooldownMs: config.breakerCooldownMs,
  }),
  cache = createStreamCache({
    ttlMs: config.streamCacheTtlMs,
    partialTtlMs: config.streamPartialCacheTtlMs,
    maxEntries: config.streamCacheMaxEntries,
  }),
  providerTimeoutMs = config.providerTimeoutMs,
  deadlineMs = config.deadlineMs,
  minProviderTimeoutMs = 1000,
  maxPerProviderStreams = config.maxPerProviderStreams,
  maxTotalStreams = config.maxTotalStreams,
  now = Date.now,
  logger = console,
} = {}) {
  async function runProviders(contentId, type, season, episode) {
    const deadline = now() + deadlineMs;
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const tmdbId = tmdbIdOf(contentId) ?? (await resolveTmdbId(contentId, type));
    if (!tmdbId) {
      logger.warn(`[streams] no TMDB id resolved for ${contentId}`);
      return [];
    }

    const timeoutMs = Math.max(
      minProviderTimeoutMs,
      Math.min(providerTimeoutMs, deadline - now())
    );
    const providers = providersForFn(mediaType);
    let partial = false;
    const results = await Promise.all(
      providers.map(async (provider) => {
        if (!breaker.attempt(provider.id)) return [];

        const started = now();
        try {
          const streams = await withTimeout(
            Promise.resolve().then(() =>
              provider.getStreams(String(tmdbId), mediaType, season, episode)
            ),
            timeoutMs,
            provider.id
          );
          const list = (Array.isArray(streams) ? streams : [])
            .filter(validStream)
            .slice(0, maxPerProviderStreams)
            .map((stream) => ({ stream, provider }));
          breaker.record(provider.id, list.length > 0 ? 'ok' : 'empty', {
            latencyMs: now() - started,
          });
          if (list.length > 0) {
            logger.log(`[streams] ${provider.id} -> ${list.length} (${now() - started}ms)`);
          }
          return list;
        } catch (err) {
          const outcome = err instanceof TimeoutError ? 'timeout' : 'error';
          breaker.record(provider.id, outcome, {
            latencyMs: now() - started,
            error: err,
          });
          if (outcome === 'timeout') {
            partial = true;
            logger.warn(`[streams] ${provider.id} timed out after ${timeoutMs}ms`);
          } else {
            logger.warn(`[streams] ${provider.id} failed: ${err.message}`);
          }
          return [];
        }
      })
    );

    return { value: dedupe(results), partial: partial || now() >= deadline };
  }

  async function collectStreams(contentId, type, season, episode, userConfig = DEFAULT_CONFIG) {
    const key = streamKey(type, contentId, season, episode);
    const raw = await cache.getOrLoad(key, () =>
      runProviders(contentId, type, season, episode)
    );

    const filtered = raw
      .map((item) => ({ ...item, rank: qualityRank(item.stream) }))
      .filter((item) => streamPassesFilters(item.stream, userConfig));

    filtered.sort((a, b) => {
      const aIsExt = isWebPage(a.stream.url || a.stream.externalUrl, a.stream) ? 1 : 0;
      const bIsExt = isWebPage(b.stream.url || b.stream.externalUrl, b.stream) ? 1 : 0;
      if (aIsExt !== bIsExt) return aIsExt - bIsExt;

      const byQuality = a.rank - b.rank;
      if (byQuality !== 0) return byQuality;
      const byHealth = breaker.score(b.provider.id) - breaker.score(a.provider.id);
      if (byHealth !== 0) return byHealth;
      return a.provider.order - b.provider.order;
    });

    const streams = filtered
      .map((item) => toStremioStream(item.stream, item.provider))
      .filter(Boolean);

    return streams.slice(0, maxTotalStreams);
  }

  async function collectSubtitles(contentId, type, season, episode, userConfig = DEFAULT_CONFIG) {
    const key = streamKey(type, contentId, season, episode);
    const raw = await cache.getOrLoad(key, () =>
      runProviders(contentId, type, season, episode)
    );

    const seen = new Set();
    const subtitles = [];
    for (const item of raw) {
      for (const track of normalizeSubtitles(item.stream.subtitles)) {
        if (seen.has(track.url)) continue;
        if (!subtitleMatchesConfig(track, userConfig)) continue;
        seen.add(track.url);
        subtitles.push(track);
      }
    }
    return subtitles;
  }

  function getRuntimeStats() {
    const registry = getProviders();
    const seen = new Map(breaker.snapshot().map((entry) => [entry.id, entry]));
    const providers = registry.map((provider) => {
      const entry = seen.get(provider.id);
      if (entry) return { name: provider.name, ...entry };
      return {
        id: provider.id,
        name: provider.name,
        state: 'closed',
        calls: 0,
        ok: 0,
        empty: 0,
        errors: 0,
        timeouts: 0,
        skipped: 0,
        consecutiveFailures: 0,
        lastMs: null,
        avgMs: null,
        maxMs: 0,
        score: 0.5,
        lastError: null,
        lastSuccessAt: null,
        openedAt: null,
      };
    });

    return {
      circuits: breaker.summary(registry.map((provider) => provider.id)),
      providers,
      streamCache: cache.stats(),
      metadataCache:
        typeof getMetadataCacheStats === 'function' ? getMetadataCacheStats() : null,
    };
  }

  return { collectStreams, collectSubtitles, getRuntimeStats };
}

const defaultCollector = createCollector();

module.exports = {
  createCollector,
  collectStreams: defaultCollector.collectStreams,
  collectSubtitles: defaultCollector.collectSubtitles,
  getRuntimeStats: defaultCollector.getRuntimeStats,
  normalizeStreamKey,
  dedupe,
};
