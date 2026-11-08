# Architecture

Stremio stream addon that wraps the CB Providers (Nuvio) scraper fleet and answers requests using IMDb IDs.

## System overview

```
Stremio client
  |  GET /stream/{movie|series}/{imdb-id}.json
  v
server.js (Node >=18, Render)
  |-- cinemeta.js   IMDb ID -> TMDB ID (Cinemeta and TMDB raced, bounded LRU, 24h/60s TTL)
  |-- providers.js  loads vendor/cb-providers/manifest.json, skips disabled ids, filters by media type
  |-- streams.js    runs providers in parallel (20s each, 25s overall deadline)
  |     |-- lib/breaker.js: per-provider circuit breaker (3 failures -> 5 min open)
  |     |-- lib/stream-cache.js: 3 min raw result cache, bounded, coalesces requests
  |     |-- provider.getStreams(tmdbId, movie|tv, season, episode)
  |     |-- dedupe by URL, then filters.js: user resolution/size/subtitle filters
  |     |-- format.js: normalize to Stremio streams (subtitles, videoSize, proxyHeaders, notWebReady, bingeGroup)
  |     `-- sort by quality rank, then provider health, then manifest order
  |-- /stats and /health: circuit, cache, and uptime telemetry
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
- `behaviorHints.configurable`: `true`; `/configure` serves the settings page.

Stream routes:

- Movie: `/stream/movie/tt0137523.json`
- Series episode: `/stream/series/tt0944947:1:1.json` (`id = imdbId:season:episode`)
- Series without season/episode returns `200 {"streams":[]}` because providers require an episode.
- Invalid IMDb ID returns `400`; unknown routes return `404`; unexpected failures return `500`.
- All routes accept `GET` and `HEAD`; `HEAD` runs the same route logic with the body suppressed, so uptime pingers such as UptimeRobot get a 200. Other methods return `405`.
- `GET /health` returns `{ ok, providers, uptimeSec, circuits: { open, halfOpen }, cacheEntries }` (cheap; used by Render); `providers` is the active (non-disabled) count.
- `GET /stats` returns detailed in-memory telemetry: per-provider circuit state and counters, stream cache stats, and metadata cache stats.
- `GET /logo.png` serves the addon logo used by `/manifest.json`.

Configured routes (settings encoded as base64url JSON in the path, no server-side state):

- Manifest: `/{config}/manifest.json`
- Stream: `/{config}/stream/{movie|series}/{id}.json`
- `GET /configure` serves the HTML builder that generates these URLs and a `stremio://` install link. The file is read once at startup and served from memory.
- A path segment that does not decode to a JSON object returns `400 {"error":"Invalid configuration"}`; plain routes use permissive defaults.

Stream object mapping (format.js):

- `name` = provider display name from the vendored manifest.
- `title` = provider `description` / `title` / `name`.
- `url` passed through (HTTP(S) or magnet).
- `infoHash` + `fileIdx` used when the provider returns no URL.
- Provider `headers` become `behaviorHints.proxyHeaders.request` with `notWebReady: true`.
- Provider `behaviorHints.bingeGroup` is preserved.
- Provider `subtitles` tracks are normalized to Stremio subtitle objects (`{id,url,lang}`) from `url`/`file`/`src` and `lang`/`language`/`label`.
- Provider `size` or size text in the title becomes `behaviorHints.videoSize`.

Results are ordered by quality rank, then provider health (Laplace-smoothed `ok/calls`), then manifest order.

Raw provider results are cached in memory for 3 minutes (`STREAM_CACHE_TTL_MS`) keyed by `type:imdbId:season:episode`, before user filters and formatting, so one entry serves every filter configuration. The cache is bounded (`STREAM_CACHE_MAX_ENTRIES`), stores only non-empty results, and coalesces concurrent identical requests. URLs are time-signed, so the TTL stays short and can be disabled with `0`.

## Components

| File | Responsibility |
| --- | --- |
| `server.js` | HTTP server, routing, CORS, manifest, logo, JSON responses |
| `config.js` | Environment configuration with defaults |
| `providers.js` | Reads vendored manifest, skips disabled ids, requires provider modules, type filtering |
| `cinemeta.js` | IMDb -> TMDB resolution and caching |
| `streams.js` | Provider orchestration, timeouts, dedupe, filtering, quality sorting |
| `filters.js` | URL config encoding/decoding, resolution/size detection, subtitle normalization, stream filtering |
| `format.js` | Provider stream -> Stremio stream conversion |
| `lib/lru.js` | Bounded TTL/LRU cache used by metadata and stream caches |
| `lib/breaker.js` | Per-provider circuit breaker and health counters |
| `lib/stream-cache.js` | 3-minute raw stream cache with in-flight coalescing |
| `lib/timeout.js` | `TimeoutError` and promise timeout helper |
| `configure.html` | Self-contained `/configure` page that builds the encoded manifest URL |
| `scripts/verify.js` | Verifies every enabled, non-disabled provider module loads and disabled ids stay out (used by CI and sync) |
| `scripts/check-audit.js` | `npm audit` gate: fails on new high/critical advisories, allows the unfixable legacy `cheerio-without-node-native` chain |
| `scripts/test-filters.js` | Unit tests for config, filters, and stream formatting (`npm test`) |
| `scripts/test-runtime.js` | Unit tests for cache, breaker, timeout, metadata race, and collector integration (`npm test`) |
| `vendor/cb-providers/` | Upstream GPL-3.0 snapshot: `providers/`, `manifest.json`, `LICENSE`, `UPSTREAM_COMMIT` |
| `eslint.config.js` | Flat ESLint config for the addon sources (vendored providers excluded) |
| `.nvmrc` | Node version pin (22) for CI and Render |
| `render.yaml` | Render blueprint matching the live service |
| `.github/workflows/` | CI and daily upstream sync |

## Provider model

- Upstream source: `https://github.com/SA7ANI/cb-providers` (GPL-3.0).
- Vendored, not used as a submodule, so Render needs no submodule support.
- `manifest.json` fields used: `id`, `name`, `filename`, `enabled`, `supportedTypes`.
- Torrent providers (`torrentio`) are listed in `DISABLED_PROVIDER_IDS` in `providers.js`. Their files and manifest entries stay vendored and sync daily, but they are never loaded or queried and do not appear in registry-derived counts.
- Provider modules export `getStreams(tmdbId, mediaType, season, episode)` where `mediaType` is `movie` or `tv`.
- Outcomes per call: non-empty valid array = `ok`, empty = `empty` (legitimate no-match), thrown error = `error`, timeout = `timeout`. Only errors and timeouts count toward the breaker.
- Type mapping: a movie request loads providers supporting `movie`; a series request loads providers supporting `tv` or `anime`.
- Runtime dependencies required by provider bundles: `cheerio`, `cheerio-without-node-native`, `axios`, `crypto-js`.
- `scripts/verify.js` fails if any enabled, non-disabled provider cannot be loaded; the sync workflow runs it before committing new upstream code.

## Runtime resilience

- Provider circuits are in-memory and per-process: 3 consecutive timeouts/errors open one for 5 minutes; after cooldown a single half-open probe decides whether to close it. Empty results reset the failure streak.
- `/stats` exposes per-provider counters, latency, last error, and state. `/health` stays cheap for Render.
- Metadata: when `TMDB_API_KEY` is set, Cinemeta and TMDB are queried concurrently and the first non-null ID wins; the loser is not awaited. Both caches are bounded LRUs.
- Streams: raw provider output is cached for 3 minutes, bounded and non-empty-only, shared across filter configs; concurrent identical requests share one provider fan-out.
- Health stats reset on restart; the Render service is single-instance, so no cross-process coordination is needed.
- On `SIGTERM`/`SIGINT` the server stops accepting connections, closes idle keep-alive sockets, and waits up to 25s for in-flight requests before exiting (Render's default shutdown budget is 30s).

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
| `PROVIDERS` | all enabled | Comma-separated active-provider allowlist; disabled ids are always excluded |
| `CINEMETA_URL` | `https://v3-cinemeta.strem.io` | Metadata resolver base URL |
| `TMDB_API_KEY` | empty | Enables the TMDB resolver, raced in parallel with Cinemeta |
| `BREAKER_FAILURE_THRESHOLD` | `3` | Consecutive timeouts/errors before a provider circuit opens |
| `BREAKER_COOLDOWN_MS` | `300000` | Open-circuit cooldown before a single half-open probe |
| `STREAM_CACHE_TTL_MS` | `180000` | Raw stream cache TTL; `0` disables storage |
| `STREAM_CACHE_MAX_ENTRIES` | `500` | Raw stream cache entry cap |
| `TMDB_CACHE_MAX_ENTRIES` | `5000` | IMDb→TMDB resolution cache cap |

## User filters

Filters are encoded in the addon URL as base64url JSON and applied per request on raw provider streams:

| Key | Values | Behavior |
| --- | --- | --- |
| `maxRes` | `any`, `2160`, `1080`, `720`, `480` | Hides streams above the ceiling. Resolution comes from `quality` or title/description text. |
| `maxSizeGB` | number or `null` | Hides streams larger than the limit. Size comes from provider `size` or `GB`/`MB` text. |
| `keepUnknown` | boolean, default `true` | When false, streams without detectable resolution/size/subtitle metadata are dropped. |
| `subtitles` | `any`, `required`, `en`, `hi`, `ta`, `te`, `ml`, `ja`, `multi` | Matches provider subtitle tracks first, then filename hints (e.g. `E-Sub`). Streams with no subtitle info follow `keepUnknown`. |

`/configure` writes these values into the manifest URL. Users switch filters by installing a new URL.

## Deployment and CI/CD

- Render web service, free plan, Singapore: `https://stremio-cb-addon.onrender.com`
- Build: `npm ci`; start: `node server.js`; health check: `/health`.
- The live service stores a user-supplied `TMDB_API_KEY` as an encrypted Render env var (never committed). It is used only by the Cinemeta fallback resolver; provider-embedded TMDB keys are unaffected.
- CI (`.github/workflows/ci.yml`): on push/PR, runs `npm ci`, ESLint (`npm run lint`), syntax check (root + `lib/`), provider registry verification, dependency audit gate (`scripts/check-audit.js`), unit tests (`npm test`: filters + runtime), and HTTP smoke tests including `/health`, `/stats`, `/configure`, and configured routes.
- Node is pinned to 22 via `.nvmrc` for both CI and Render.
- Sync (`.github/workflows/sync-upstream.yml`): daily at 03:17 UTC (also manual). It vendors the latest upstream providers (including disabled ones), verifies the active provider set, and commits only when valid. The resulting commit triggers CI.
- Keep-alive (`.github/workflows/keep-alive.yml`): four daily 5h50m jobs ping `/health` every 10 minutes so the free instance does not sleep; this shape costs ~1,400 Actions minutes/month instead of ~4,320 for a separate 10-minute cron.
- Docs-only commits use `[skip ci]` (plus `[skip render]`) to avoid unnecessary builds.
- Render uses `autoDeployTrigger: checksPass`, so deploys start only after the CI checks for the commit pass.
- The audit gate allowlists four GHSA advisories reachable only through `cheerio-without-node-native`'s vendored `jsdom 7`/`request` tree, which has no fix; any new high/critical advisory fails CI.

## Failure modes and constraints

- **Render free tier sleeps after 15 minutes idle.** The first request afterward cold-starts and may exceed Stremio's request timeout.
- **Datacenter IP blocking.** Some upstream sites reject cloud IPs. The breaker catches timeouts/throws, but most providers swallow blocked responses and return empty, so `/stats` empty counts are the signal; fewer providers respond on Render than locally.
- **Signed URLs expire.** Raw results are cached for at most 3 minutes; responses are otherwise bounded by the 20s/25s timeouts.
- **All circuits open.** A request can return no new streams until a cooldown probe succeeds; cached entries still serve if present.
- **Filtering is opt-in.** Plain routes only sort by quality; configured routes apply resolution/size/subtitle filters. Metadata is provider-supplied, so unknown values are controlled by `keepUnknown`.
- **Upstream drift.** A new provider may require a new npm dependency; the sync workflow's verification fails before committing in that case, so the fix is to add the dependency and re-run the sync.

## Maintenance

- `memory.md` is the project's running log; append meaningful changes and commit docs with `[skip ci]`.
- After upstream changes are synced, `vendor/cb-providers/UPSTREAM_COMMIT` records the upstream SHA.
