# Architecture

Stremio stream addon that wraps the CB Providers (Nuvio) scraper fleet and answers requests using IMDb IDs.

## System overview

```
Stremio client
  |  GET /stream/{movie|series}/{imdb-id}.json
  v
server.js (Node >=18, Render)
  |-- cinemeta.js   IMDb ID -> TMDB ID (Cinemeta, 24h cache; optional TMDB API fallback)
  |-- providers.js  loads vendor/cb-providers/manifest.json, filters by media type
  |-- streams.js    runs providers in parallel (20s each, 25s overall deadline)
  |     |-- provider.getStreams(tmdbId, movie|tv, season, episode)
  |     |-- format.js: normalize to Stremio streams (proxyHeaders, notWebReady, bingeGroup)
  |     `-- dedupe by URL, sort by quality rank
  v
{ "streams": [ ... ] }
```

## Stremio protocol

Manifest (`/manifest.json`):

- `id`: `community.cb-providers`
- `resources`: `["stream"]`
- `types`: `["movie", "series"]`
- `idPrefixes`: `["tt"]`
- `catalogs`: `[]`

Stream routes:

- Movie: `/stream/movie/tt0137523.json`
- Series episode: `/stream/series/tt0944947:1:1.json` (`id = imdbId:season:episode`)
- Series without season/episode returns `200 {"streams":[]}` because providers require an episode.
- Invalid IMDb ID returns `400`; unknown routes return `404`; unexpected failures return `500`.
- `GET /health` returns `{ ok: true, providers: <loaded count> }`.
- `GET /logo.png` serves the addon logo used by `/manifest.json`.

Stream object mapping (format.js):

- `name` = provider display name from the vendored manifest.
- `title` = provider `description` / `title` / `name`.
- `url` passed through (HTTP(S) or magnet).
- `infoHash` + `fileIdx` used when the provider returns no URL.
- Provider `headers` become `behaviorHints.proxyHeaders.request` with `notWebReady: true`.
- Provider `behaviorHints.bingeGroup` is preserved.

Stream results are never cached: many provider URLs are time-signed and expire.

## Components

| File | Responsibility |
| --- | --- |
| `server.js` | HTTP server, routing, CORS, manifest, logo, JSON responses |
| `config.js` | Environment configuration with defaults |
| `providers.js` | Reads vendored manifest, requires provider modules, type filtering |
| `cinemeta.js` | IMDb -> TMDB resolution and caching |
| `streams.js` | Provider orchestration, timeouts, dedupe, quality sorting |
| `format.js` | Provider stream -> Stremio stream conversion |
| `scripts/verify.js` | Verifies every enabled provider module loads (used by CI and sync) |
| `vendor/cb-providers/` | Upstream GPL-3.0 snapshot: `providers/`, `manifest.json`, `LICENSE`, `UPSTREAM_COMMIT` |
| `render.yaml` | Render blueprint matching the live service |
| `.github/workflows/` | CI and daily upstream sync |

## Provider model

- Upstream source: `https://github.com/SA7ANI/cb-providers` (GPL-3.0).
- Vendored, not used as a submodule, so Render needs no submodule support.
- `manifest.json` fields used: `id`, `name`, `filename`, `enabled`, `supportedTypes`.
- Provider modules export `getStreams(tmdbId, mediaType, season, episode)` where `mediaType` is `movie` or `tv`.
- Type mapping: a movie request loads providers supporting `movie`; a series request loads providers supporting `tv` or `anime`.
- Runtime dependencies required by provider bundles: `cheerio`, `cheerio-without-node-native`, `axios`, `crypto-js`.
- `scripts/verify.js` fails if any enabled provider cannot be loaded; the sync workflow runs it before committing new upstream code.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `7000` | Listen port (Render injects its own) |
| `ADDON_NAME` | `CB Providers` | Manifest display name |
| `PROVIDER_MANIFEST` | `vendor/cb-providers/manifest.json` | Provider registry path |
| `PROVIDER_DIR` | `vendor/cb-providers/providers` | Provider bundle directory |
| `PROVIDER_TIMEOUT_MS` | `20000` | Per-provider timeout |
| `ADDON_DEADLINE_MS` | `25000` | Overall time budget per stream request |
| `PROVIDERS` | all enabled | Comma-separated provider allowlist |
| `CINEMETA_URL` | `https://v3-cinemeta.strem.io` | Metadata resolver base URL |
| `TMDB_API_KEY` | empty | Optional fallback when Cinemeta lacks `moviedb_id` |

## Deployment and CI/CD

- Render web service, free plan, Singapore: `https://stremio-cb-addon.onrender.com`
- Build: `npm ci`; start: `node server.js`; health check: `/health`.
- CI (`.github/workflows/ci.yml`): on push/PR, runs `npm ci`, syntax check, provider registry verification, and HTTP smoke tests.
- Sync (`.github/workflows/sync-upstream.yml`): daily at 03:17 UTC (also manual). It vendors the latest upstream providers, verifies the full provider set, and commits only when valid. The resulting commit triggers Render auto-deploy.
- Docs-only commits use `[skip ci]` (plus `[skip render]`) to avoid unnecessary builds.
- Render auto-deploy is not gated on CI by default; enable "Auto-Deploy -> After CI Checks Pass" in the service settings if desired.

## Failure modes and constraints

- **Render free tier sleeps after 15 minutes idle.** The first request afterward cold-starts and may exceed Stremio's request timeout.
- **Datacenter IP blocking.** Some upstream sites reject cloud IPs, so fewer providers respond on Render than locally.
- **Signed URLs expire.** Streams are resolved on demand and not persisted; response times are bounded by the 20s/25s timeouts.
- **Quality is sorted, not filtered.** Providers can return 480p/360p/CAM for older or regional titles.
- **Upstream drift.** A new provider may require a new npm dependency; the sync workflow's verification fails before committing in that case, so the fix is to add the dependency and re-run the sync.

## Maintenance

- `memory.md` is the project's running log; append meaningful changes and commit docs with `[skip ci]`.
- After upstream changes are synced, `vendor/cb-providers/UPSTREAM_COMMIT` records the upstream SHA.
