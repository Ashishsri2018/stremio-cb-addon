'use strict';

const { spawnSync } = require('child_process');

// All current high/critical advisories come from the legacy
// cheerio-without-node-native -> jsdom 7 -> request chain, which has no fix.
const allowedAdvisories = new Map([
  ['GHSA-fjxv-7rqg-78g4', 'form-data <=2.5.5 (request -> jsdom -> cheerio-without-node-native)'],
  ['GHSA-hmw2-7cc7-3qxx', 'form-data <2.5.6 (request -> jsdom -> cheerio-without-node-native)'],
  ['GHSA-rp65-9cf3-cjxr', 'nth-check <2.0.1 (css-select@1 -> cheerio-without-node-native)'],
  ['GHSA-p8p7-x288-28g6', 'request <=2.88.2 (jsdom -> cheerio-without-node-native)'],
]);

const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || '');
} catch {
  report = null;
}

if (!report || !report.vulnerabilities) {
  console.error('npm audit did not return a vulnerability report');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

function isHighSeverity(severity) {
  return severity === 'high' || severity === 'critical';
}

const seen = new Map();

function isAllowed(name) {
  if (seen.has(name)) return seen.get(name);
  const vulnerability = report.vulnerabilities[name];
  if (!vulnerability || !isHighSeverity(vulnerability.severity)) return true;

  seen.set(name, false);
  let allowed = true;
  for (const via of vulnerability.via || []) {
    if (typeof via === 'object') {
      const id = String(via.url || '').split('/').pop();
      if (isHighSeverity(via.severity) && !allowedAdvisories.has(id)) allowed = false;
    } else if (!isAllowed(via)) {
      allowed = false;
    }
  }
  seen.set(name, allowed);
  return allowed;
}

const blocked = Object.keys(report.vulnerabilities).filter(
  (name) => isHighSeverity(report.vulnerabilities[name].severity) && !isAllowed(name)
);

for (const [id, reason] of allowedAdvisories) {
  console.log(`allowed ${id}: ${reason}`);
}

if (blocked.length > 0) {
  console.error(`\nUnapproved high/critical vulnerabilities: ${blocked.join(', ')}`);
  process.exit(1);
}

console.log('audit gate passed');
