const fs = require('fs');
const path = require('path');
const { getRegistry } = require('../providers');

const manifestPath = path.join(__dirname, '..', 'vendor', 'cb-providers', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expected = (manifest.providers || []).filter((p) => p.enabled !== false).length;
const loaded = getRegistry();

console.log(`providers: expected ${expected}, loaded ${loaded.length}`);
if (loaded.length !== expected) {
  console.error('Provider registry mismatch: a provider failed to load');
  process.exit(1);
}
