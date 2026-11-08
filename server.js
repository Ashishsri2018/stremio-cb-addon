const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getRegistry } = require('./providers');
const { collectStreams } = require('./streams');
const { DEFAULT_CONFIG, decodeConfig } = require('./filters');

const logoPath = path.join(__dirname, 'logo.png');
const configurePath = path.join(__dirname, 'configure.html');
const streamRoute = /^\/stream\/(movie|series)\/([^/]+)\.json$/;
const configManifestRoute = /^\/([A-Za-z0-9_-]{1,512})\/manifest\.json$/;
const configStreamRoute = /^\/([A-Za-z0-9_-]{1,512})\/stream\/(movie|series)\/([^/]+)\.json$/;
const imdbPattern = /^(tt\d+)(?::(\d+):(\d+))?$/;

function sendJson(res, status, body, cacheControl = 'no-store') {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': cacheControl,
  });
  res.end(JSON.stringify(body));
}

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`;
  return `${proto}://${host}`;
}

function manifestFor(req) {
  return {
    id: 'community.cb-providers',
    version: '1.0.0',
    name: config.addonName,
    description:
      'Multi-provider stream addon powered by the CB Providers fleet (MoviesDrive, 4KHDHub, HDHub4u, VegaMovies, NetMirror, Torrentio, anime providers and more). Resolves content from IMDb IDs. Configure resolution, size, and subtitle filters at /configure.',
    logo: `${baseUrl(req)}/logo.png`,
    types: ['movie', 'series'],
    resources: ['stream'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: true },
  };
}

function resolveRoute(pathname) {
  if (pathname === '/manifest.json') {
    return { kind: 'manifest', config: DEFAULT_CONFIG };
  }

  let match = streamRoute.exec(pathname);
  if (match) {
    return { kind: 'stream', type: match[1], rawId: match[2], config: DEFAULT_CONFIG };
  }

  match = configManifestRoute.exec(pathname);
  if (match) {
    const config = decodeConfig(match[1]);
    return config ? { kind: 'manifest', config } : { kind: 'invalid-config' };
  }

  match = configStreamRoute.exec(pathname);
  if (match) {
    const config = decodeConfig(match[1]);
    return config
      ? { kind: 'stream', type: match[2], rawId: match[3], config }
      : { kind: 'invalid-config' };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/') {
    sendJson(res, 200, {
      addon: config.addonName,
      manifest: `${baseUrl(req)}/manifest.json`,
      configure: `${baseUrl(req)}/configure`,
      example: `${baseUrl(req)}/stream/movie/tt0137523.json`,
    });
    return;
  }

  if (pathname === '/configure') {
    fs.readFile(configurePath, (err, data) => {
      if (err) {
        sendJson(res, 500, { error: 'Configure page unavailable' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
      });
      res.end(data);
    });
    return;
  }

  if (pathname === '/logo.png') {
    fs.readFile(logoPath, (err, data) => {
      if (err) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=86400',
      });
      res.end(data);
    });
    return;
  }

  if (pathname === '/health') {
    sendJson(res, 200, { ok: true, providers: getRegistry().length });
    return;
  }

  const route = resolveRoute(pathname);
  if (!route) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (route.kind === 'invalid-config') {
    sendJson(res, 400, { error: 'Invalid configuration' });
    return;
  }
  if (route.kind === 'manifest') {
    sendJson(res, 200, manifestFor(req), 'public, max-age=300');
    return;
  }

  const { type, config: userConfig } = route;
  let rawId;
  try {
    rawId = decodeURIComponent(route.rawId);
  } catch {
    sendJson(res, 400, { error: 'Invalid id encoding' });
    return;
  }

  const idMatch = imdbPattern.exec(rawId);
  if (!idMatch) {
    sendJson(res, 400, { error: 'Expected IMDb id: tt1234567 or tt1234567:season:episode' });
    return;
  }

  const imdbId = idMatch[1];
  const season = idMatch[2] ? Number(idMatch[2]) : null;
  const episode = idMatch[3] ? Number(idMatch[3]) : null;

  if (type === 'series' && (season === null || episode === null)) {
    sendJson(res, 200, { streams: [] });
    return;
  }

  try {
    const streams = await collectStreams(imdbId, type, season, episode, userConfig);
    const label = season === null ? imdbId : `${imdbId} S${season}E${episode}`;
    console.log(
      `[server] ${type} ${label} -> ${streams.length} streams (${Date.now() - started}ms)`
    );
    sendJson(res, 200, { streams });
  } catch (err) {
    console.error(`[server] ${type} ${imdbId}: ${err.stack || err.message}`);
    sendJson(res, 500, { error: 'Internal error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`${config.addonName} addon listening on http://${config.host}:${config.port}`);
  console.log(`Manifest: ${config.providerManifest}`);
  console.log(`Providers: ${getRegistry().length}`);
});
