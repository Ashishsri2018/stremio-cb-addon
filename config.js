const path = require('path');

function envInt(name, fallback, min) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored >= min ? floored : fallback;
}

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 7000),
  addonName: process.env.ADDON_NAME || 'CB Providers',
  providerManifest: process.env.PROVIDER_MANIFEST || path.join(__dirname, 'vendor', 'cb-providers', 'manifest.json'),
  providerDir: process.env.PROVIDER_DIR || path.join(__dirname, 'vendor', 'cb-providers', 'providers'),
  providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 20000),
  deadlineMs: Number(process.env.ADDON_DEADLINE_MS || 25000),
  breakerFailureThreshold: envInt('BREAKER_FAILURE_THRESHOLD', 3, 1),
  breakerCooldownMs: envInt('BREAKER_COOLDOWN_MS', 300000, 0),
  streamCacheTtlMs: envInt('STREAM_CACHE_TTL_MS', 180000, 0),
  streamCacheMaxEntries: envInt('STREAM_CACHE_MAX_ENTRIES', 500, 0),
  tmdbCacheMaxEntries: envInt('TMDB_CACHE_MAX_ENTRIES', 5000, 1),
  maxPerProviderStreams: envInt('MAX_PER_PROVIDER_STREAMS', 100, 1),
  maxTotalStreams: envInt('MAX_TOTAL_STREAMS', 1000, 1),
  onlyProviders: String(process.env.PROVIDERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cinemetaUrl: (process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io').replace(/\/$/, ''),
  tmdbApiKey: process.env.TMDB_API_KEY || '',
};
