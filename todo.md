# Project Tasks & Roadmap

## Active Tasks
- [x] Investigate wrong/non-functional links returned by scrapers (embeds, slow-down blockers, bot redirects)
- [x] Create modular URL classifier in `lib/url-classifier.js` (< 150 lines)
- [x] Map web pages and HTML embeds to Stremio `externalUrl` in `format.js`
- [x] Drop rate-limit and blocker links (`/slowdown`) at ingestion in `streams.js`
- [x] Prioritize direct video streams before external web links in `streams.js`
- [x] Add offline unit tests for classifier and sorting in `scripts/test-filters.js` and `scripts/test-runtime.js`
- [x] Hide secrets, live domain URLs, and host service IDs across codebase and workflows
- [x] Make `keep-alive.yml` safely use `HEALTH_CHECK_URL` repository secret
- [x] Update documentation (`architecture.md`, `memory.md`, `README.md`)
- [ ] Push sanitized commits to GitHub repository

## Future Improvements
- [ ] Residential/proxy support to mitigate datacenter IP blocking on cloud hosts
- [ ] Adaptive provider weighting based on circuit breaker success ratios
- [ ] Additional subtitle language mappings
