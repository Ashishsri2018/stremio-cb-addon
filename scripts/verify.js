const fs = require('fs');
const path = require('path');
const { DISABLED_PROVIDER_IDS, getRegistry } = require('../providers');

const manifestPath = path.join(__dirname, '..', 'vendor', 'cb-providers', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestIds = new Set((manifest.providers || []).map((p) => p.id));
const expected = (manifest.providers || []).filter(
  (p) => p.enabled !== false && !DISABLED_PROVIDER_IDS.has(p.id)
).length;
const loaded = getRegistry();
const leaked = loaded.filter((p) => DISABLED_PROVIDER_IDS.has(p.id));

for (const id of DISABLED_PROVIDER_IDS) {
  if (!manifestIds.has(id)) {
    console.warn(`[verify] disabled provider "${id}" is no longer in the manifest`);
  }
}

console.log(`providers: expected ${expected}, loaded ${loaded.length}`);
if (leaked.length > 0) {
  console.error(`Disabled providers were loaded: ${leaked.map((p) => p.id).join(', ')}`);
  process.exit(1);
}
if (loaded.length !== expected) {
  console.error('Provider registry mismatch: active provider count differs from the manifest');
  process.exit(1);
}
