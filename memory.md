# Project Memory

Running log for this repository. Newest entries first.

Conventions:

- Append an entry for meaningful changes, deployments, incidents, and decisions.
- Docs-only commits: `git commit -m "docs: ... [skip ci] [skip render]"`.
- Keep the "Current state" section short and current.

## Current state (2026-11-08)

- Repo: `https://github.com/Ashishsri2018/stremio-cb-addon` (private, GPL-3.0)
- Live addon: `https://stremio-cb-addon.onrender.com` (install with `/manifest.json`)
- Render service: `srv-dbo0nv3rjlhs73a3qavg`, free plan, Singapore, health `/health`
- Providers: 28 vendored from `SA7ANI/cb-providers`, upstream SHA `40514501c0505474bc6a0d8e1d9821c2a2e37020`
- CI/CD: GitHub Actions CI on push; upstream sync daily 03:17 UTC; Render auto-deploy on commit
- Verified live: `/health` shows 28 providers; `tt0137523` returned 66 streams from 12 providers (70 streams / 16 providers locally)
- Filters: `/configure` builds a base64url config URL with max resolution, max size, keep-unknown, and subtitle filters
- TMDB fallback: user-supplied key stored as a Render secret (not in git); providers still use their embedded keys
- Runtime resilience: per-provider circuit breaker + `/stats`; Cinemeta/TMDB raced in parallel; raw stream results cached 3 min

## Log

### 2026-11-08 - Circuit breaker, parallel metadata, stream cache

- Added `lib/breaker.js`, `lib/stream-cache.js`, `lib/lru.js`, and `lib/timeout.js`.
- Provider outcomes are classified as `ok`, `empty`, `timeout`, or `error`. Three consecutive timeouts/errors open a circuit for 5 minutes; one half-open probe is allowed after cooldown. Empty results reset the streak and never count as failures.
- Added `GET /stats` with per-provider counters/state, stream cache stats, and metadata cache stats. `/health` now includes uptime, open circuits, and cache entries.
- IMDb→TMDB resolution races Cinemeta and TMDB when `TMDB_API_KEY` is set; the first non-null ID wins and the loser is not awaited. Both caches are bounded LRUs (24h positive / 60s negative).
- Raw provider results are cached for 3 minutes before filters/formatting, bounded to 500 entries, non-empty only, with in-flight coalescing. Filters still run per request.
- Stream ordering is quality rank, then Laplace-smoothed provider health, then manifest order.
- New env vars: `BREAKER_FAILURE_THRESHOLD=3`, `BREAKER_COOLDOWN_MS=300000`, `STREAM_CACHE_TTL_MS=180000`, `STREAM_CACHE_MAX_ENTRIES=500`, `TMDB_CACHE_MAX_ENTRIES=5000`.
- Verification: `npm test` passes (9 filter + 26 runtime checks); `npm run verify` loads 28/28; a mock-provider E2E confirmed cache hits on repeat requests, circuit open after 3 errors, and skip-without-invocation on the 4th request.

### 2026-11-08 - Credential audit and TMDB fallback key

- Audited all 28 providers: none needs a user-supplied API key, login, or cookie to return streams.
- Providers embed their own TMDB keys. Three of the four shared keys are valid and one is dead, but every provider retains at least one working key. No provider reads `process.env`.
- Cookies are automatic: MoviesMod mints per-request anti-bot and PHPSESSID cookies, MovieBox uses an anonymous bearer token plus a signed playback Cookie (forwarded via `proxyHeaders`), HDHub4u ships a static bypass Cookie, and Einthusan logs in only if `premiumEmail`/`premiumPassword` are injected via `globalThis.SCRAPER_SETTINGS` (not required for free streams).
- Only Torrentio (optional Debrid provider/key) and Einthusan (language toggles) expose provider settings; this addon does not inject `SCRAPER_SETTINGS`, so defaults apply.
- Set the user-provided TMDB key as an encrypted Render env var (`TMDB_API_KEY`) for the Cinemeta-to-TMDB fallback. The value is not committed; `render.yaml` declares it with `sync: false`.
- Local verification: with Cinemeta unreachable, `tt0137523` resolved to TMDB 550 through the fallback.

### 2026-11-08 - Configurable filters and /configure page

- Added `/configure`, a self-contained dark HTML page that generates an encoded manifest URL and a `stremio://` install link.
- Config keys: `maxRes` (`any|2160|1080|720|480`), `maxSizeGB` (number or null), `keepUnknown` (default `true`), `subtitles` (`any|required|en|hi|ta|te|ml|ja|multi`).
- Added configured routes `/{config}/manifest.json` and `/{config}/stream/{type}/{id}.json`; invalid configs return 400. Plain routes keep permissive defaults.
- Manifest now advertises `behaviorHints.configurable: true`; stream output now includes normalized `subtitles` and `behaviorHints.videoSize`.
- Filters run on raw provider streams before formatting. Unknown resolution/size/subtitle metadata is kept only when `keepUnknown` is true.
- Added `scripts/test-filters.js` (`npm test`) and CI smoke checks for `/configure` and configured routes.
- Deployed commit `193b971`: CI passed, Render went Live. Strict config (`1080p`, `2 GB`, no unknowns, subtitles required) reduced `tt0137523` from 66 to 2 valid MoviesDrive streams (720p/1.36 GB and 480p/484 MB, both with E-Sub hints).

### 2026-11-08 - Documentation added

- Added `architecture.md` (system design, protocol, config, deployment) and this running log.
- Docs commits intentionally skip CI and Render builds.

### 2026-11-08 - Render deployment live

- Created private GitHub repo and pushed the addon with vendored providers.
- Render's GitHub app initially could not access the new private repo; after access was granted, created the service via Render CLI.
- Verified push-to-deploy with a test commit: CI passed, Render built and went live automatically.
- Live checks: `/health` = 28 providers; invalid ID = 400; movie `tt0137523` = 66 streams / 12 providers in ~26s.
- Datacenter IP blocking observed: 12 providers responded on Render vs 16 locally; upstream sites sometimes reject cloud IPs.

### 2026-11-08 - CI and daily upstream sync

- Added `ci.yml`: `npm ci`, syntax checks, provider registry verification (`scripts/verify.js`), HTTP smoke test.
- Added `sync-upstream.yml`: daily at 03:17 UTC, vendors upstream `providers/`, `manifest.json`, `LICENSE`, and commit SHA; verifies before committing.
- Manually dispatched the sync workflow successfully; upstream SHA recorded in `vendor/cb-providers/UPSTREAM_COMMIT`.
- Updated workflows to `actions/checkout@v5` and `actions/setup-node@v5`.

### 2026-11-08 - Addon implementation

- Ported CB Providers to the Stremio addon protocol (manifest + `/stream/{type}/{id}.json`).
- IMDb IDs resolve to TMDB via Cinemeta's `moviedb_id` (24h cache); optional `TMDB_API_KEY` fallback.
- Provider calls run in parallel with a 20s per-provider timeout and 25s overall deadline.
- Streams are deduped by URL, sorted by quality rank, and mapped to Stremio objects with `proxyHeaders` / `notWebReady` and `bingeGroup`.
- Fixed provider runtime deps by installing `axios` and `crypto-js` alongside `cheerio` and `cheerio-without-node-native`.
- Local verification: movie `tt0137523` 70 streams / 16 providers; series `tt0944947:1:1` 58 streams; invalid ID 400; series without episode returns empty streams.

## Open items

- Implement a soft deadline (~10s) that returns partial results instead of waiting for the full 25s deadline.
- Provider-level optional settings (Torrentio Debrid key, Einthusan premium login/language toggles) are not exposed by this Stremio addon; providers read them from `globalThis.SCRAPER_SETTINGS`, which is never set.
- Add a min-resolution floor if requested (the current resolution filter is a ceiling).
- Consider enabling Render "Auto-Deploy -> After CI Checks Pass" to gate deploys on CI.
- Consider a keep-alive strategy for Render free-tier cold starts.
- Datacenter IP blocking limits provider coverage on Render; a residential/self-hosted deployment may return more sources.
