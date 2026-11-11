const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getRegistry } = require('./providers');
const { collectStreams, collectSubtitles, getRuntimeStats } = require('./streams');
const { DEFAULT_CONFIG, decodeConfig } = require('./filters');
const { parseContentId, toContentId } = require('./content-id');
const { buildStatus } = require('./telemetry');

const logoPath = path.join(__dirname, 'logo.png');
const configurePath = path.join(__dirname, 'configure.html');
const startedAt = Date.now();
const shutdownTimeoutMs = 25000;
const streamRoute = /^\/stream\/(movie|series)\/([^/]+)\.json$/;
const subtitleRoute = /^\/subtitles\/(movie|series)\/([^/]+?)(?:\/[^/]+)?\.json$/;
const configManifestRoute = /^\/([A-Za-z0-9_-]{1,512})\/manifest\.json$/;
const configStreamRoute = /^\/([A-Za-z0-9_-]{1,512})\/stream\/(movie|series)\/([^/]+)\.json$/;
const configSubtitleRoute =
  /^\/([A-Za-z0-9_-]{1,512})\/subtitles\/(movie|series)\/([^/]+?)(?:\/[^/]+)?\.json$/;

let configureHtml = null;
try {
  configureHtml = fs.readFileSync(configurePath);
} catch (err) {
  console.error(`[server] failed to load configure.html: ${err.message}`);
}

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

function uptimeSeconds() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function statusPayload() {
  const runtime = getRuntimeStats();
  return buildStatus({
    addon: config.addonName,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: uptimeSeconds(),
    status: 'ok',
    snapshot: null,
    providers: {
      total: getRegistry().length,
      circuits: runtime.circuits,
      stats: runtime.providers,
    },
    cache: {
      stream: runtime.streamCache,
      metadata: runtime.metadataCache,
    },
    metrics: runtime.metrics,
  });
}

function manifestFor(req) {
  return {
    id: 'community.cb-providers',
    version: '1.0.0',
    name: config.addonName,
    description:
      'Multi-provider stream addon powered by the CB Providers fleet (MoviesDrive, 4KHDHub, HDHub4u, VegaMovies, NetMirror, anime providers and more). Resolves content from IMDb or TMDB IDs and serves provider subtitle tracks. Configure resolution and size filters plus the subtitle language at /configure.',
    logo: `${baseUrl(req)}/logo.png`,
    types: ['movie', 'series'],
    resources: ['stream', 'subtitles'],
    idPrefixes: ['tt', 'tmdb:'],
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

  match = subtitleRoute.exec(pathname);
  if (match) {
    return { kind: 'subtitles', type: match[1], rawId: match[2], config: DEFAULT_CONFIG };
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

  match = configSubtitleRoute.exec(pathname);
  if (match) {
    const config = decodeConfig(match[1]);
    return config
      ? { kind: 'subtitles', type: match[2], rawId: match[3], config }
      : { kind: 'invalid-config' };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
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
    if (!configureHtml) {
      sendJson(res, 500, { error: 'Configure page unavailable' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    });
    res.end(configureHtml);
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

  if (pathname === '/health' || pathname === '/stats') {
    sendJson(res, 200, statusPayload());
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

  const parsedId = parseContentId(rawId);
  if (!parsedId) {
    sendJson(res, 400, {
      error:
        'Expected id: tt1234567, tt1234567:season:episode, tmdb:123 or tmdb:123:season:episode',
    });
    return;
  }

  const contentId = toContentId(parsedId);
  const { season, episode } = parsedId;

  if (type === 'series' && (season === null || episode === null)) {
    sendJson(res, 200, route.kind === 'subtitles' ? { subtitles: [] } : { streams: [] });
    return;
  }

  try {
    const label = season === null ? contentId : `${contentId} S${season}E${episode}`;
    if (route.kind === 'subtitles') {
      const subtitles = await collectSubtitles(
        contentId,
        type,
        season,
        episode,
        userConfig
      );
      console.log(
        `[server] subtitles ${type} ${label} -> ${subtitles.length} tracks (${Date.now() - started}ms)`
      );
      sendJson(res, 200, { subtitles }, 'public, max-age=180');
      return;
    }

    const streams = await collectStreams(contentId, type, season, episode, userConfig);
    console.log(
      `[server] ${type} ${label} -> ${streams.length} streams (${Date.now() - started}ms)`
    );
    sendJson(res, 200, { streams });
  } catch (err) {
    console.error(`[server] ${type} ${contentId}: ${err.stack || err.message}`);
    sendJson(res, 500, { error: 'Internal error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`${config.addonName} addon listening on http://${config.host}:${config.port}`);
  console.log(`Manifest: ${config.providerManifest}`);
  console.log(`Providers: ${getRegistry().length}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, draining connections`);
  server.close(() => {
    console.log('[server] shutdown complete');
    process.exit(0);
  });
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  setTimeout(() => {
    console.error('[server] shutdown timed out, exiting');
    process.exit(1);
  }, shutdownTimeoutMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
