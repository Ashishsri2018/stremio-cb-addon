# Stremio CB Addon

A high-performance, modular [Stremio](https://www.stremio.com/) stream and subtitles addon aggregating streams from multiple community providers (vendored from `cb-providers` / Nuvio). Resolves movies and TV series using both IMDb (`tt...`) and TMDB (`tmdb:...`) IDs.

## Features

- **27+ Community Scrapers**: Queries enabled community providers concurrently with bounded timeouts.
- **Smart Stream Classification**:
  - Direct video streams (`.m3u8`, `.mpd`, `.mp4`, `.mkv`, etc.) map to native Stremio playback (`url`).
  - Web pages, HTML embeds, and download links map to `externalUrl` to open cleanly in a browser without triggering player decode errors.
  - Direct video streams always sort ahead of external web links.
- **Ingestion Filtering**: Automatically drops anti-bot slowdown blockers and corrupted redirect loops.
- **Configurable User Filters** (`/configure`):
  - **Resolution Ceiling**: Filter out streams above 4K, 1080p, 720p, or 480p.
  - **Size Limit**: Maximum file size in GB.
  - **Subtitle Preferences**: Filter tracks returned by the subtitles resource (English, Hindi, Tamil, Telugu, Malayalam, Japanese, or multi). Video streams are never hidden.
  - **Unknown Metadata**: Choose whether to keep or discard streams without detectable resolution/size.
- **Dual Resource Support**: Advertises both `stream` and `subtitles` resources to Stremio.
- **Production Resilience**:
  - In-memory circuit breakers with exponential backoff for failing or slow providers.
  - Real-time diagnostic endpoints at `/health` and `/stats`, both returning the same canonical telemetry JSON.
  - 3-minute bounded LRU stream cache before per-user filtering; partial results expire after 30 seconds and empty results are never cached.
  - Cinemeta + TMDB parallel metadata racing with a 24-hour LRU cache.
- **Automated Upstream Sync**: Daily GitHub Actions workflow syncs and verifies scrapers from upstream `SA7ANI/cb-providers`.

---

## Quick Start (Local Development)

### Prerequisites

- Node.js >= 18 (Node 22 recommended, see `.nvmrc`)
- npm >= 9

### Installation

```bash
git clone https://github.com/Ashishsri2018/stremio-cb-addon.git
cd stremio-cb-addon
npm ci
```

### Running Locally

```bash
# Start with all active providers
npm start

# Or run on a custom port
PORT=7000 npm start

# Run with a subset of providers for faster local testing
PROVIDERS=netmirror,moviebox npm start
```

Once running:
- Open http://127.0.0.1:7000/manifest.json in your browser or install it in Stremio.
- Open http://127.0.0.1:7000/configure to configure custom stream filters.
- Open http://127.0.0.1:7000/health or `/stats` to view the same live circuit, provider, cache, and request statistics.

---

## Testing & Code Quality

```bash
# Run unit tests (offline test suite for filters, classification, and runtime)
npm test

# Run ESLint
npm run lint

# Verify that all enabled providers in the manifest load successfully
npm run verify

# Run security audit gate (checks dependencies against known advisories)
node scripts/check-audit.js
```

---

## Configuration & Environment Variables

The addon can be configured with the following environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7000` | HTTP port the server listens on |
| `PROVIDER_TIMEOUT_MS` | `20000` | Timeout per scraper execution (milliseconds) |
| `ADDON_DEADLINE_MS` | `25000` | Global deadline for stream aggregation per request |
| `TMDB_API_KEY` | *(empty)* | Optional TMDB v3 API key to resolve IMDb IDs concurrently with Cinemeta |
| `PROVIDERS` | *(all)* | Comma-separated list of provider IDs to enable (e.g. `netmirror,vidsrc`) |
| `HEALTH_CHECK_URL` | *(empty)* | Secret/URL used by `.github/workflows/keep-alive.yml` to ping `/health` |

---

## Deployment

### Deploy to Render

This repository includes a `render.yaml` Blueprint for 1-click deployment on Render:

1. Fork or push this repository to GitHub.
2. In the Render Dashboard, go to **Blueprints** and select your repository.
3. (Optional) Set the `TMDB_API_KEY` environment variable in the Render Dashboard for enhanced metadata resolution.
4. Render deploys the service with health checks configured on `/health`.

### Keep-Alive for Free Hosting

Render free tier instances sleep after 15 minutes of inactivity. If deploying to Render's free tier, you can configure GitHub Actions to keep the instance warm:

1. Go to your repository settings on GitHub: **Settings** → **Secrets and variables** → **Actions**.
2. Add a repository secret named `HEALTH_CHECK_URL` with your deployment's health check URL (e.g., `https://<your-service>.onrender.com/health`).
3. The `.github/workflows/keep-alive.yml` workflow will automatically ping the endpoint every 10 minutes. If the secret is not set, the workflow safely skips.

---

## Architecture Overview

```
                      +-------------------+
                      |   Stremio Client  |
                      +---------+---------+
                                |
             GET /stream/{type}/{id}.json or /configure
                                |
                      +---------v---------+
                      |     server.js     |
                      +---------+---------+
                                |
        +-----------------------+-----------------------+
        |                                               |
+-------v-------+                               +-------v-------+
|  cinemeta.js  | (races TMDB if key set)       |   streams.js  |
+-------+-------+                               +-------+-------+
        |                                               |
        +-----------------------+-----------------------+
                                |
                      +---------v---------+
                      |   providers.js    | (circuit breakers)
                      +---------+---------+
                                |
                    vendor/cb-providers/providers/
                                |
                      +---------v---------+
                      | url-classifier.js |
                      +---------+---------+
                     /                     \
      Direct video streams              Web pages / Embeds
         (Stremio `url`)              (Stremio `externalUrl`)
```

For more architectural details, see [architecture.md](architecture.md).

---

## Upstream Synchronization

Upstream scrapers are vendored under `vendor/cb-providers/` and synchronized automatically by `.github/workflows/sync-upstream.yml` every day at 03:17 UTC.

> [!IMPORTANT]
> Never manually edit files in `vendor/cb-providers/`, as they are refreshed daily from upstream. Any custom addon behavior, deduplication, URL classification, or fixes must be implemented in addon code (`lib/`, `streams.js`, `format.js`).

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
Vendored provider scrapers retain their original licenses and attribution to `SA7ANI/cb-providers`.
