const STATUSES = new Set(['ok', 'degraded', 'error']);

function numberOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'object' && typeof value.message === 'string') {
    return value.message.slice(0, 300);
  }
  return String(value).slice(0, 300);
}

function normalizeState(value) {
  if (value === 'open' || value === 'half-open') return value;
  return 'closed';
}

function normalizeProvider(input = {}) {
  const calls = nullableNumber(input.calls);
  const ok = nullableNumber(input.ok);
  const successRate =
    nullableNumber(input.successRate) ??
    (calls !== null && calls > 0 && ok !== null
      ? Math.round((ok / calls) * 1000) / 1000
      : null);

  return {
    id: String(input.id ?? ''),
    state: normalizeState(input.state),
    calls,
    ok,
    empty: nullableNumber(input.empty),
    errors: nullableNumber(input.errors),
    timeouts: nullableNumber(input.timeouts),
    skipped: nullableNumber(input.skipped),
    successRate,
    avgMs: nullableNumber(input.avgMs),
    lastMs: nullableNumber(input.lastMs),
    maxMs: nullableNumber(input.maxMs),
    lastError: errorOrNull(input.lastError),
    lastSuccessAt: isoOrNull(input.lastSuccessAt),
  };
}

function normalizeStreamCache(input = {}) {
  return {
    enabled: Boolean(input.enabled),
    hits: numberOr(input.hits),
    misses: numberOr(input.misses),
    coalesced: numberOr(input.coalesced),
    sets: numberOr(input.sets),
    evictions: numberOr(input.evictions),
    expired: numberOr(input.expired),
    size: numberOr(input.size),
    maxEntries: numberOr(input.maxEntries),
    ttlMs: numberOr(input.ttlMs),
    partialTtlMs: numberOr(input.partialTtlMs),
  };
}

function normalizeMetadataCache(input) {
  if (!input) return null;
  return {
    hits: numberOr(input.hits),
    misses: numberOr(input.misses),
    sets: numberOr(input.sets),
    evictions: numberOr(input.evictions),
    expired: numberOr(input.expired),
    size: numberOr(input.size),
    maxEntries: numberOr(input.maxEntries),
  };
}

function normalizeMetrics(input = {}) {
  return {
    requests: numberOr(input.requests),
    cacheHits: numberOr(input.cacheHits),
    cacheMisses: numberOr(input.cacheMisses),
    emptyResults: numberOr(input.emptyResults),
    deadlineHits: numberOr(input.deadlineHits),
    settleHits: numberOr(input.settleHits),
    providerFailures: numberOr(input.providerFailures),
  };
}

function buildStatus(input = {}, now = Date.now()) {
  const status = STATUSES.has(input.status) ? input.status : 'ok';
  const uptimeSec = Math.max(0, Math.floor(numberOr(input.uptimeSec, process.uptime())));
  const checkedAt = new Date(now).toISOString();
  const startedAt =
    isoOrNull(input.startedAt) ?? new Date(now - uptimeSec * 1000).toISOString();

  const snapshot = input.snapshot ?? {};
  const fetchedAt = isoOrNull(snapshot.fetchedAt);
  const ageMs =
    nullableNumber(snapshot.ageMs) ??
    (fetchedAt ? Math.max(0, now - Date.parse(fetchedAt)) : null);

  const providers = input.providers ?? {};
  const stats = Array.isArray(providers.stats)
    ? providers.stats.map(normalizeProvider).sort((a, b) => a.id.localeCompare(b.id))
    : [];

  return {
    ok: status !== 'error',
    addon: String(input.addon ?? ''),
    status,
    startedAt,
    uptimeSec,
    checkedAt,
    snapshot: {
      sha: snapshot.sha == null ? null : String(snapshot.sha),
      fetchedAt,
      ageMs,
      refreshing: Boolean(snapshot.refreshing),
      lastError: errorOrNull(snapshot.lastError),
    },
    providers: {
      total: numberOr(providers.total, stats.length),
      circuits: {
        open: numberOr(providers.circuits?.open),
        halfOpen: numberOr(providers.circuits?.halfOpen),
      },
      stats,
    },
    cache: {
      stream: normalizeStreamCache(input.cache?.stream),
      metadata: normalizeMetadataCache(input.cache?.metadata),
    },
    metrics: normalizeMetrics(input.metrics),
  };
}

module.exports = { buildStatus };
