# Improvement Backlog

Reviewed 2026-11-08. Baseline: 9/9 filter tests pass, 28/28 providers load. The code is structurally sound; the biggest wins are latency, resilience, and operational safety.

## Status (2026-11-08)

Implemented: item 2 (circuit breaker + `/stats`), item 3 (parallel IMDb→TMDB + bounded cache), and item 4 (3-minute bounded stream cache with in-flight coalescing). Item 1 (soft deadline) and the remaining items are still open.

## Highest impact

1. **Don't wait for slow/failing providers** — `streams.js:29` uses `Promise.all`, so every request waits for the slowest of 28 scrapers (20s per-provider timeout, 25s deadline in `config.js:9-10`). 12/28 providers respond on Render vs 16 locally, so most requests burn ~20s waiting on dead ones. Add a soft deadline (~10s): return whatever arrived, let the rest resolve in the background. This alone should cut typical response time by more than half.

2. **Provider circuit breaker + health stats** — done: `lib/breaker.js` counts timeouts/errors, opens for 5 min after 3 consecutive failures, allows one half-open probe, and `/stats` exposes per-provider state/counters. Stream ordering now uses provider health as a same-quality tie-break.

3. **Resolve IMDb→TMDB faster** — done: Cinemeta and TMDB are raced with `Promise.any` (first non-null wins), in-flight lookups are deduped, and the cache is a bounded LRU (`TMDB_CACHE_MAX_ENTRIES`).

4. **Coalesce duplicate requests** — done: `lib/stream-cache.js` coalesces in-flight identical requests and caches non-empty raw results for 3 minutes (`STREAM_CACHE_TTL_MS`), bounded to 500 entries. Filters still run per request.

5. **Basic abuse protection** — `server.js:74` is a public endpoint where each request fans out 28 outbound scrapes. A per-IP token bucket + global concurrency cap prevents someone (or a bad client loop) from hammering upstream sites and getting the server IP banned.

6. **Fix Render cold starts** — free tier sleeps after 15 min; a GitHub Actions cron (or UptimeRobot) hitting `/health` every 10 min keeps it warm and stays within the 750 free hours.

## Medium

7. **Manifest version is hardcoded** (`server.js:34`) — derive it from `package.json` so Stremio refreshes its cached manifest on release.

8. **Sync workflow security** — `sync-upstream.yml` runs upstream provider code with a `contents: write` token. Split verification (read-only job) from the push job, use `npm ci --ignore-scripts`, and alert on failure (e.g., auto-open an issue) so sync doesn't silently stop updating.

9. **Filter bug** — `filters.js:56`: `direct[quality]` hits `Object.prototype` (`quality: 'constructor'` returns a function). Use `Object.create(null)` + `hasOwn`.

10. **User-facing polish** — `format.js:26`: `name` is only the provider name; include quality/size (e.g., `MoviesDrive · 1080p · 1.4 GB`) so the stream list is scannable. Synthesize `bingeGroup` per provider+show for better episode grouping. Add min-resolution, "exclude CAM/TS", and provider checkboxes to `/configure`.

11. **Configure page UX** — prefill from an existing `/{config}/configure` URL, remember settings in localStorage, and add a "test this config" button that calls a known movie and shows stream counts.

## Housekeeping

12. **Add a README** — `architecture.md` and `memory.md` are excellent, but there is no README with install URL, env vars, and deploy steps.

13. **More tests** — only filters/format are covered; add mock-provider tests for `collectStreams` (soft deadline, dedupe, timeout, circuit breaker) by injecting providers, plus route tests. Consider `node:test` over the hand-rolled runner.

14. **CI additions** — ESLint, `npm audit`, Dependabot, Node version pin (`.nvmrc`), and gate Render deploys on CI (`Auto-Deploy → After CI Checks Pass`, already an open item).

15. **Graceful shutdown** — handle `SIGTERM` with `server.close()` so Render redeploys don't kill in-flight requests; cache `configure.html` in memory instead of reading per request.

## Operational note

Since the addon scrapes third-party sites, avoid proxying video through the server (bandwidth/liability) — `proxyHeaders` on the client is the right approach.

## Suggested next

Item 1 (soft deadline) is now the highest-impact remaining change; then rate limiting (item 5) and sync-workflow hardening (item 8).
