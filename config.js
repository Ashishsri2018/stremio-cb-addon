const path = require('path');

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 7000),
  addonName: process.env.ADDON_NAME || 'CB Providers',
  providerManifest: process.env.PROVIDER_MANIFEST || path.join(__dirname, 'vendor', 'cb-providers', 'manifest.json'),
  providerDir: process.env.PROVIDER_DIR || path.join(__dirname, 'vendor', 'cb-providers', 'providers'),
  providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 20000),
  deadlineMs: Number(process.env.ADDON_DEADLINE_MS || 25000),
  onlyProviders: String(process.env.PROVIDERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cinemetaUrl: (process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io').replace(/\/$/, ''),
  tmdbApiKey: process.env.TMDB_API_KEY || '',
};
