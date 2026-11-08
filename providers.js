const fs = require('fs');
const path = require('path');
const config = require('./config');

let registry = null;

function loadProvider(entry) {
  const file = path.join(config.providerDir, path.basename(entry.filename));
  const mod = require(file);
  const getStreams =
    typeof mod.getStreams === 'function'
      ? mod.getStreams
      : mod.default && typeof mod.default.getStreams === 'function'
        ? mod.default.getStreams
        : null;

  if (!getStreams) throw new Error('missing getStreams export');

  return {
    id: entry.id,
    name: entry.name || entry.id,
    types: Array.isArray(entry.supportedTypes) ? entry.supportedTypes : ['movie', 'tv'],
    getStreams,
    order: 0,
  };
}

function getRegistry() {
  if (registry) return registry;

  const manifest = JSON.parse(fs.readFileSync(config.providerManifest, 'utf8'));
  const allow = config.onlyProviders;
  const entries = (manifest.providers || []).filter(
    (p) => p.enabled !== false && (allow.length === 0 || allow.includes(p.id))
  );

  registry = [];
  for (const entry of entries) {
    try {
      const provider = loadProvider(entry);
      provider.order = registry.length;
      registry.push(provider);
    } catch (err) {
      console.warn(`[providers] skipped ${entry.id}: ${err.message}`);
    }
  }

  console.log(`[providers] loaded ${registry.length}/${entries.length}`);
  return registry;
}

function providersFor(mediaType) {
  const wanted = mediaType === 'tv' ? ['tv', 'anime'] : ['movie'];
  return getRegistry().filter((p) => p.types.some((t) => wanted.includes(t)));
}

module.exports = { getRegistry, providersFor };
