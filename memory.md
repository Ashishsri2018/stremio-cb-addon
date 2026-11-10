# Project Memory

Running log for this repository. Newest entries first.

Conventions:

- Append an entry for meaningful changes, deployments, incidents, and decisions.
- Docs-only commits: `git commit -m "docs: ... [skip ci] [skip render]"`.
- Keep the "Current state" section short and current.

## Current state (2026-11-10)

- Repo: `https://github.com/Ashishsri2018/stremio-cb-addon` (private, GPL-3.0)
- Live addon: `https://stremio-cb-addon.onrender.com` (install with `/manifest.json`)
- Render service: `srv-dbo0nv3rjlhs73a3qavg`, free plan, Singapore, health `/health`
- Providers: 28 vendored from `SA7ANI/cb-providers`, 27 active (Torrentio disabled in addon code but kept for daily sync), upstream SHA `e66d80656b4b1ec79aa391cb5a864ae98de36fa1`
- CI/CD: GitHub Actions CI on push; upstream sync daily 03:17 UTC; Render auto-deploy after CI checks pass
- Verified live on 2026-11-10: `/health` ok with 27 providers; `tt0137523` returned 53 streams, `tmdb:550` returned 54 streams, series `tt0944947:1:1` returned 31 streams; all 27 circuits closed/healthy
- IDs: manifest advertises `tt` and `tmdb:`; `tmdb:` ids go straight to providers, `tt` ids resolve via Cinemeta/TMDB
- Filters: `/configure` builds a base64url config URL with max resolution, max size, keep-unknown, and subtitle filters
- Manifest advertises both `stream` and `subtitles` resources; `/subtitles/{type}/{id}` aggregates provider tracks from the shared raw cache
- TMDB fallback: user-supplied key stored as a Render secret (not in git); providers still use their embedded keys
- Runtime resilience: per-provider circuit breaker + `/stats`; Cinemeta/TMDB raced in parallel; raw stream results cached 3 min
- Keep-alive: `.github/workflows/keep-alive.yml` pings `/health` every 10 min via four daily 5h50m jobs (~1,400 Actions min/month)

## Log

### 2026-11-10 - Upstream sync and verification (e66d806)

- Scheduled workflow `.github/workflows/sync-upstream.yml` ran successfully (run 42805185951, commit `8400292`), vendoring upstream `SA7ANI/cb-providers` @ `e66d80656b`.
- Updated provider files: `desiflix.js`, `puretoons.js`, `toonstream.js`, `vidrock.js`.
- Render auto-deployed and is live. Verified `/health` (ok, 27 active providers), `/stats` (all 27 circuits closed, 0 open), `/manifest.json`, movie `tt0137523` (53 streams across 10 providers), `tmdb:550` (54 streams), series `tt0944947:1:1` (31 streams), and `/subtitles` (1 track). All local tests and `verify.js` (27/27) pass.

### 2026-11-09 - Direct TMDB id support

- Manifest now advertises `idPrefixes: ["tt", "tmdb:"]` (Nuvio's addons screen shows "2 id rules").
- New `content-id.js` parses `tt1234567[:season:episode]` and `tmdb:123[:season:episode]`; all other id shapes return `400`.
- `streams.js` uses `tmdb:` ids directly and only calls Cinemeta/TMDB resolution for `tt` ids; raw stream cache keys use the canonical content id.
- Why: AIOMetadata TMDB-sourced catalogs emit `tmdb:` ids, and Nuvio only queries stream addons whose `idPrefixes` match the item id, so those titles previously never reached the addon. MAL/Kitsu (`mal:`, `kitsu:`) ids are still unsupported.
- Verification: `npm test`, `npm run lint`; local smoke with `PROVIDERS=netmirror`: `tmdb:550` (Fight Club) returned a NetMirror stream, `tmdb:1399` series without episode returned `{"streams":[]}`, invalid ids returned `400`.

### 2026-11-08 - Stremio subtitles resource for Nuvio Mobile

- Manifest now advertises `resources: ["stream", "subtitles"]` (string entries inherit `types` and `idPrefixes`). Added `/subtitles/{movie|series}/{id}.json` and `/{config}/subtitles/...`; the optional Stremio extras segment is accepted and ignored.
- `collectSubtitles` in `streams.js` flattens `normalizeSubtitles()` from the same raw provider cache and dedupes by URL. User filters are not applied; the response is `{subtitles:[{id,url,lang}]}` with `cache-control: public, max-age=180`.
- Why: Nuvio Mobile's `StreamParser` ignores inline `streams[].subtitles`; it only queries addons that declare a `subtitles` resource. Stremio and Nuvio TV already consume the inline tracks.
- Verification: `npm test`, `npm run lint`, `npm run verify` (27/27); manual `PROVIDERS=moviebox` returned subtitle tracks for movie and series ids; extras-path, configured, invalid-id, and missing-season routes behave correctly.

### 2026-11-08 - Nuvio Mobile subtitle interop investigation

- Nuvio Mobile ignores stream-embedded subtitles from Stremio addons. `StreamParser.parse` (`composeApp/src/commonMain/kotlin/com/nuvio/app/features/streams/StreamParser.kt`) never reads `streams[].subtitles`; `StreamItem.externalSubtitles` is populated only for Nuvio plugin scraper results (`StreamFetchSupport.kt`). NuvioTV (`StreamDto.subtitles`) and Stremio do parse inline subtitles, so the gap is specific to Nuvio Mobile.
- Nuvio Mobile only queries addons whose manifest declares a `subtitles`/`subtitle` resource (`AddonSubtitleLoader.addonSubtitleRequests`) via `/subtitles/:type/:videoId[/extras].json`. This addon advertises only `stream` and has no `/subtitles` route, so Nuvio never asks it for subtitles.
- Confirmed the addon does return inline subs: `PROVIDERS=moviebox` for `tt0137523` returned 1 stream with 2 English tracks.
- Reference clone: `/root/iptv/NuvioMobile` at `de60c5a` (0.6.10-beta), kept for future interop checks.

### 2026-11-08 - Torrent providers disabled

- `torrentio` is the only torrent-based provider in the vendored fleet. `DISABLED_PROVIDER_IDS` in `providers.js` now excludes it when the registry is built, so it is never loaded or queried and no longer appears in `/health`, `/stats`, or stream ordering.
- The provider file and manifest entry are untouched; the daily sync still copies every upstream provider, so Torrentio keeps updating without ever running.
- `scripts/verify.js` now expects 27 active providers, fails if a disabled id is loaded, and warns if a disabled id disappears from the manifest. The addon manifest description no longer advertises Torrentio.
- Verification: lint and tests pass; `npm run verify` -> 27/27; `PROVIDERS=torrentio` starts with 0 providers and returns `{"streams":[]}`; default startup reports 27 providers with no Torrentio in `/stats`.

### 2026-11-08 - HEAD support for uptime pingers

- UptimeRobot reported `405 Method Not Allowed` because the server only admitted GET/OPTIONS. The method gate now also admits HEAD; Node suppresses the response body for HEAD, so status and headers match GET.
- `access-control-allow-methods` now lists `GET, HEAD, OPTIONS`.
- CI smoke test asserts `HEAD /` and `HEAD /health` return 200.

### 2026-11-08 - Render keep-alive workflow

- Added `.github/workflows/keep-alive.yml`: scheduled at 01:17/07:17/13:17/19:17 UTC; each run pings `/health` every 10 minutes for 5h50m.
- A separate run every 10 minutes would bill ~4,320 Actions minutes/month, over the 2,000 free private-repo quota. Four long jobs cost ~1,400 minutes and leave a 10-minute gap, below Render's 15-minute sleep threshold.
- The job fails after 3 consecutive non-200 pings; `workflow_dispatch` starts a full shift on demand. No event data is interpolated into the script.
- Verified locally: YAML parses, the loop pings success and exits 0, and a dead endpoint exits 1 after 3 failures.

### 2026-11-08 - CI hardening, graceful shutdown, filter prototype fix

- Fixed the direct-quality lookup in `filters.js`: the table now has a null prototype and uses `Object.hasOwn`, so values such as `constructor` or `__proto__` cannot hit `Object.prototype`. Added regression assertions.
- Added ESLint 10 (flat config) and `npm run lint`; CI lints addon sources and excludes vendored providers.
- Added `scripts/check-audit.js`: `npm audit --omit=dev --audit-level=high` passes only while high/critical advisories are limited to the known, unfixable `cheerio-without-node-native` -> `jsdom 7`/`request` chain. Any new high/critical advisory fails CI.
- Pinned Node 22 in `.nvmrc`; CI now uses `node-version-file`. Added weekly Dependabot updates for npm and GitHub Actions.
- `render.yaml` now uses `autoDeployTrigger: checksPass`, so Render deploys only after CI passes.
- `configure.html` is read once at startup. `SIGTERM`/`SIGINT` now stop the listener, close idle keep-alive sockets, and drain in-flight requests for up to 25s before exiting.
- Verification: lint clean; audit gate passes with four allowlisted advisories; `npm test` passes (9 filter + 26 runtime checks); `npm run verify` loads 28/28; `/configure` and `/stats` served locally; SIGTERM exited 0 in ~120ms.

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
- Re-review the audit allowlist if `cheerio-without-node-native` is replaced; it currently pins the legacy `request`/`jsdom` tree.
- Consider a keep-alive strategy for Render free-tier cold starts.
- Datacenter IP blocking limits provider coverage on Render; a residential/self-hosted deployment may return more sources.
