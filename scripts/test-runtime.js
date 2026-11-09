const assert = require('assert');
const { createLru } = require('../lib/lru');
const { createBreaker } = require('../lib/breaker');
const { createStreamCache } = require('../lib/stream-cache');
const { TimeoutError, withTimeout } = require('../lib/timeout');
const { createMetadataResolver } = require('../cinemeta');
const { createCollector } = require('../streams');
const { DEFAULT_CONFIG } = require('../filters');

const silentLogger = { log() {}, warn() {}, error() {} };

function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

function fakeClock(start = 1000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withDeadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function provider(id, order, getStreams) {
  return { id, name: id, order, types: ['movie'], getStreams };
}

function makeCollector({ providers, breaker, cache, timeoutMs = 5, resolveTmdbId = async () => 1 }) {
  return createCollector({
    providersFor: () => providers,
    getProviders: () => providers,
    resolveTmdbId,
    getMetadataCacheStats: () => ({ size: 0 }),
    breaker,
    cache,
    providerTimeoutMs: timeoutMs,
    deadlineMs: 1000,
    minProviderTimeoutMs: 1,
    logger: silentLogger,
  });
}

async function main() {
  check('lru stores values and respects ttl', () => {
    const clock = fakeClock();
    const lru = createLru({ maxEntries: 2, now: clock.now });
    lru.set('a', { n: 1 }, clock.now() + 100);
    assert.deepStrictEqual(lru.get('a'), { n: 1 });
    clock.advance(101);
    assert.strictEqual(lru.get('a'), undefined);
    const stats = lru.stats();
    assert.strictEqual(stats.expired, 1);
    assert.strictEqual(stats.size, 0);
  });

  check('lru evicts the least recently used entry', () => {
    const clock = fakeClock();
    const lru = createLru({ maxEntries: 2, now: clock.now });
    lru.set('a', 1);
    lru.set('b', 2);
    assert.strictEqual(lru.get('a'), 1);
    lru.set('c', 3);
    assert.strictEqual(lru.get('b'), undefined);
    assert.strictEqual(lru.get('a'), 1);
    assert.strictEqual(lru.get('c'), 3);
    const stats = lru.stats();
    assert.strictEqual(stats.size, 2);
    assert.strictEqual(stats.evictions, 1);
    assert.ok(stats.hits >= 1);
  });

  check('breaker opens after consecutive timeouts and skips calls', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 3, cooldownMs: 60000, now: clock.now });
    for (let i = 0; i < 3; i += 1) {
      assert.strictEqual(breaker.attempt('p'), true);
      breaker.record('p', 'timeout', { latencyMs: 10, error: new TimeoutError('p', 10) });
    }
    assert.strictEqual(breaker.snapshot()[0].state, 'open');
    assert.strictEqual(breaker.attempt('p'), false);
    assert.strictEqual(breaker.snapshot()[0].skipped, 1);
  });

  check('breaker resets the failure streak on empty or ok', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 3, cooldownMs: 60000, now: clock.now });
    breaker.attempt('p');
    breaker.record('p', 'error', { error: new Error('x') });
    breaker.attempt('p');
    breaker.record('p', 'error', { error: new Error('x') });
    breaker.attempt('p');
    breaker.record('p', 'empty');
    assert.strictEqual(breaker.snapshot()[0].state, 'closed');
    breaker.attempt('p');
    breaker.record('p', 'timeout');
    breaker.attempt('p');
    breaker.record('p', 'timeout');
    assert.strictEqual(breaker.snapshot()[0].state, 'closed');
    assert.strictEqual(breaker.snapshot()[0].consecutiveFailures, 2);
  });

  check('breaker half-open allows one probe and closes on success', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 1, cooldownMs: 1000, now: clock.now });
    assert.strictEqual(breaker.attempt('p'), true);
    breaker.record('p', 'timeout');
    assert.strictEqual(breaker.attempt('p'), false);
    clock.advance(1000);
    assert.strictEqual(breaker.attempt('p'), true);
    assert.strictEqual(breaker.attempt('p'), false);
    breaker.record('p', 'ok', { latencyMs: 5 });
    assert.strictEqual(breaker.snapshot()[0].state, 'closed');
    assert.strictEqual(breaker.attempt('p'), true);
  });

  check('breaker reopens when the half-open probe fails', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 1, cooldownMs: 1000, now: clock.now });
    breaker.attempt('p');
    breaker.record('p', 'error', { error: new Error('boom') });
    clock.advance(1000);
    assert.strictEqual(breaker.attempt('p'), true);
    breaker.record('p', 'timeout');
    assert.strictEqual(breaker.snapshot()[0].state, 'open');
    assert.strictEqual(breaker.attempt('p'), false);
  });

  check('breaker snapshot reports half-open after cooldown without consuming it', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 1, cooldownMs: 1000, now: clock.now });
    breaker.attempt('p');
    breaker.record('p', 'timeout');
    clock.advance(1000);
    assert.strictEqual(breaker.snapshot()[0].state, 'half-open');
    assert.strictEqual(breaker.attempt('p'), true);
  });

  check('breaker score is smoothed and summary covers unseen ids', () => {
    const clock = fakeClock();
    const breaker = createBreaker({ now: clock.now });
    assert.strictEqual(breaker.score('new'), 0.5);
    breaker.attempt('p');
    breaker.record('p', 'ok');
    assert.ok(breaker.score('p') > 0.5);
    breaker.attempt('p');
    breaker.record('p', 'empty');
    assert.ok(breaker.score('p') <= 0.5);
    assert.deepStrictEqual(breaker.summary(['p', 'unseen']), {
      closed: 2,
      open: 0,
      halfOpen: 0,
      total: 2,
    });
  });

  await checkAsync('stream cache serves non-empty results within ttl', async () => {
    const clock = fakeClock();
    const cache = createStreamCache({ ttlMs: 1000, maxEntries: 2, now: clock.now });
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return [{ stream: { url: 'u' }, provider: { id: 'p' } }];
    };
    const first = await cache.getOrLoad('k', loader);
    const second = await cache.getOrLoad('k', loader);
    assert.strictEqual(loads, 1);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(cache.stats().hits, 1);
    assert.strictEqual(cache.stats().sets, 1);
    clock.advance(1001);
    await cache.getOrLoad('k', loader);
    assert.strictEqual(loads, 2);
  });

  await checkAsync('stream cache does not store empty results', async () => {
    const cache = createStreamCache({ ttlMs: 1000, maxEntries: 2 });
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return [];
    };
    await cache.getOrLoad('k', loader);
    await cache.getOrLoad('k', loader);
    assert.strictEqual(loads, 2);
    assert.strictEqual(cache.stats().sets, 0);
  });

  await checkAsync('stream cache coalesces concurrent loads', async () => {
    const cache = createStreamCache({ ttlMs: 1000, maxEntries: 2 });
    const gate = deferred();
    let loads = 0;
    const loader = () => {
      loads += 1;
      return gate.promise;
    };
    const first = cache.getOrLoad('k', loader);
    const second = cache.getOrLoad('k', loader);
    gate.resolve([{ stream: { url: 'u' }, provider: { id: 'p' } }]);
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(loads, 1);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(cache.stats().coalesced, 1);
  });

  await checkAsync('stream cache clears in-flight entries after rejection', async () => {
    const cache = createStreamCache({ ttlMs: 1000, maxEntries: 2 });
    let loads = 0;
    await assert.rejects(
      cache.getOrLoad('k', async () => {
        loads += 1;
        throw new Error('boom');
      }),
      /boom/
    );
    const value = await cache.getOrLoad('k', async () => {
      loads += 1;
      return [{ stream: { url: 'u' }, provider: { id: 'p' } }];
    });
    assert.strictEqual(loads, 2);
    assert.strictEqual(value.length, 1);
  });

  await checkAsync('stream cache evicts least recently used entries', async () => {
    const cache = createStreamCache({ ttlMs: 60000, maxEntries: 1 });
    const make = (url) => async () => [{ stream: { url }, provider: { id: 'p' } }];
    await cache.getOrLoad('a', make('a'));
    await cache.getOrLoad('b', make('b'));
    let loads = 0;
    await cache.getOrLoad('a', async () => {
      loads += 1;
      return [{ stream: { url: 'a2' }, provider: { id: 'p' } }];
    });
    assert.strictEqual(loads, 1);
    assert.strictEqual(cache.stats().evictions, 2);
  });

  await checkAsync('withTimeout rejects with TimeoutError and swallows late rejections', async () => {
    const gate = deferred();
    await assert.rejects(
      withTimeout(gate.promise, 10, 'slow'),
      (err) => err instanceof TimeoutError && /slow/.test(err.message)
    );
    gate.reject(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  await checkAsync('withTimeout resolves fast promises', async () => {
    assert.strictEqual(await withTimeout(Promise.resolve(7), 100, 'fast'), 7);
  });

  await checkAsync('metadata resolver races cinemeta and tmdb', async () => {
    let tmdbCalls = 0;
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: 'key',
      cacheMaxEntries: 10,
      logger: silentLogger,
      fetchJsonFn: async (url) => {
        if (url.includes('/meta/')) return { meta: { moviedb_id: 550 } };
        tmdbCalls += 1;
        return new Promise(() => {});
      },
    });
    const value = await withDeadline(
      resolver.resolveTmdbId('tt1', 'movie'),
      200,
      'resolver waited for the losing source'
    );
    assert.strictEqual(value, 550);
    assert.strictEqual(tmdbCalls, 1);
  });

  await checkAsync('metadata resolver falls back to tmdb when cinemeta has no id', async () => {
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: 'key',
      cacheMaxEntries: 10,
      logger: silentLogger,
      fetchJsonFn: async (url) =>
        url.includes('/meta/') ? { meta: {} } : { movie_results: [{ id: 42 }] },
    });
    assert.strictEqual(await resolver.resolveTmdbId('tt2', 'movie'), 42);
  });

  await checkAsync('metadata resolver falls back to tmdb when cinemeta throws', async () => {
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: 'key',
      cacheMaxEntries: 10,
      logger: silentLogger,
      fetchJsonFn: async (url) => {
        if (url.includes('/meta/')) throw new Error('cinemeta down');
        return { tv_results: [{ id: 43 }] };
      },
    });
    assert.strictEqual(await resolver.resolveTmdbId('tt3', 'series'), 43);
  });

  await checkAsync('metadata resolver returns null when both sources fail', async () => {
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: 'key',
      cacheMaxEntries: 10,
      logger: silentLogger,
      fetchJsonFn: async () => {
        throw new Error('down');
      },
    });
    assert.strictEqual(await resolver.resolveTmdbId('tt4', 'movie'), null);
  });

  await checkAsync('metadata resolver uses cinemeta only without a tmdb key', async () => {
    const urls = [];
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: '',
      cacheMaxEntries: 10,
      logger: silentLogger,
      fetchJsonFn: async (url) => {
        urls.push(url);
        return { meta: { moviedb_id: 7 } };
      },
    });
    assert.strictEqual(await resolver.resolveTmdbId('tt5', 'series'), 7);
    assert.strictEqual(urls.length, 1);
    assert.ok(urls[0].includes('/meta/series/tt5.json'));
  });

  await checkAsync('metadata cache dedupes in-flight lookups and expires negatives', async () => {
    const clock = fakeClock();
    const gate = deferred();
    let calls = 0;
    const resolver = createMetadataResolver({
      cinemetaUrl: 'http://cinemeta.test',
      tmdbApiKey: '',
      cacheMaxEntries: 10,
      now: clock.now,
      logger: silentLogger,
      fetchJsonFn: async () => {
        calls += 1;
        return gate.promise;
      },
    });
    const first = resolver.resolveTmdbId('tt6', 'movie');
    const second = resolver.resolveTmdbId('tt6', 'movie');
    gate.resolve({ meta: {} });
    assert.strictEqual(await first, null);
    assert.strictEqual(await second, null);
    assert.strictEqual(calls, 1);
    clock.advance(61000);
    assert.strictEqual(await resolver.resolveTmdbId('tt6', 'movie'), null);
    assert.strictEqual(calls, 2);
    assert.strictEqual(resolver.cacheStats().size, 1);
  });

  await checkAsync('collector caches raw streams across filter configs', async () => {
    const clock = fakeClock();
    const breaker = createBreaker({ now: clock.now });
    const cache = createStreamCache({ ttlMs: 60000, maxEntries: 10, now: clock.now });
    let calls = 0;
    const source = provider('p', 0, async () => {
      calls += 1;
      return [
        { url: 'https://x/4k.m3u8', quality: '4K', title: 'Movie 4K' },
        { url: 'https://x/1080.m3u8', quality: '1080p', title: 'Movie 1080p' },
      ];
    });
    const collector = makeCollector({ providers: [source], breaker, cache });

    const all = await collector.collectStreams('tt1', 'movie', null, null, DEFAULT_CONFIG);
    assert.strictEqual(all.length, 2);
    const limited = await collector.collectStreams('tt1', 'movie', null, null, {
      ...DEFAULT_CONFIG,
      maxRes: '1080',
    });
    assert.strictEqual(limited.length, 1);
    assert.strictEqual(calls, 1);
    assert.strictEqual(cache.stats().hits, 1);

    const stats = collector.getRuntimeStats();
    assert.strictEqual(stats.circuits.total, 1);
    assert.strictEqual(stats.providers[0].ok, 1);
  });

  await checkAsync('collector uses tmdb content ids without metadata lookup', async () => {
    let resolverCalls = 0;
    let received;
    const source = provider('p', 0, async (tmdbId, mediaType, season, episode) => {
      received = { tmdbId, mediaType, season, episode };
      return [{ url: 'https://x/tmdb.m3u8', quality: '1080p' }];
    });
    const collector = makeCollector({
      providers: [source],
      resolveTmdbId: async () => {
        resolverCalls += 1;
        return 1;
      },
    });

    const streams = await collector.collectStreams('tmdb:550', 'movie', null, null, DEFAULT_CONFIG);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(resolverCalls, 0);
    assert.deepStrictEqual(received, {
      tmdbId: '550',
      mediaType: 'movie',
      season: null,
      episode: null,
    });

    const episodeStreams = await collector.collectStreams('tmdb:1399', 'series', 3, 4, DEFAULT_CONFIG);
    assert.strictEqual(episodeStreams.length, 1);
    assert.strictEqual(resolverCalls, 0);
    assert.deepStrictEqual(received, {
      tmdbId: '1399',
      mediaType: 'tv',
      season: 3,
      episode: 4,
    });
  });

  await checkAsync('collector aggregates and dedupes subtitles across provider streams', async () => {
    const clock = fakeClock();
    const breaker = createBreaker({ now: clock.now });
    const cache = createStreamCache({ ttlMs: 60000, maxEntries: 10, now: clock.now });
    let calls = 0;
    const first = provider('first', 0, async () => {
      calls += 1;
      return [
        {
          url: 'https://x/one',
          subtitles: [
            { url: 'https://sub/english.srt', language: 'English' },
            { file: 'https://sub/hindi.srt', label: 'Hindi' },
          ],
        },
        {
          url: 'https://x/two',
          subtitles: [{ url: 'https://sub/english.srt', language: 'eng' }],
        },
      ];
    });
    const second = provider('second', 1, async () => [
      {
        url: 'https://x/three',
        subtitles: [{ url: 'https://sub/japanese.srt', lang: 'ja' }],
      },
    ]);
    const collector = makeCollector({ providers: [first, second], breaker, cache });

    const subtitles = await collector.collectSubtitles('tt7', 'movie', null, null);
    assert.deepStrictEqual(
      subtitles.map((track) => track.url),
      ['https://sub/english.srt', 'https://sub/hindi.srt', 'https://sub/japanese.srt']
    );
    assert.strictEqual(subtitles[0].lang, 'en');
    assert.strictEqual(subtitles[1].lang, 'hi');
    assert.strictEqual(subtitles[2].lang, 'ja');

    const streams = await collector.collectStreams('tt7', 'movie', null, null, DEFAULT_CONFIG);
    assert.strictEqual(streams.length, 3);
    assert.strictEqual(calls, 1);
    assert.strictEqual(cache.stats().hits, 1);
  });

  await checkAsync('collector skips open circuits without invoking providers', async () => {
    const clock = fakeClock();
    const breaker = createBreaker({ threshold: 1, cooldownMs: 60000, now: clock.now });
    breaker.attempt('bad');
    breaker.record('bad', 'timeout', { error: new TimeoutError('bad', 1) });

    let badCalls = 0;
    const bad = provider('bad', 0, async () => {
      badCalls += 1;
      return [{ url: 'https://x/bad' }];
    });
    const good = provider('good', 1, async () => [
      { url: 'https://x/good', quality: '1080p' },
    ]);
    const cache = createStreamCache({ ttlMs: 0, maxEntries: 10, now: clock.now });
    const collector = makeCollector({ providers: [bad, good], breaker, cache });

    const streams = await collector.collectStreams('tt2', 'movie', null, null);
    assert.strictEqual(badCalls, 0);
    assert.strictEqual(streams.length, 1);

    const stats = collector.getRuntimeStats();
    assert.strictEqual(stats.streamCache.enabled, false);
    assert.strictEqual(stats.circuits.open, 1);
    const badStats = stats.providers.find((entry) => entry.id === 'bad');
    assert.strictEqual(badStats.skipped, 1);
  });

  await checkAsync('collector orders by quality, then health, then manifest order', async () => {
    const scores = { fourk: 0.1, low: 0.2, high: 0.9 };
    const breaker = {
      attempt: () => true,
      record: () => {},
      score: (id) => scores[id] ?? 0.5,
      snapshot: () => [],
      summary: () => ({ closed: 3, open: 0, halfOpen: 0, total: 3 }),
    };
    const cache = { getOrLoad: (key, loader) => loader(), stats: () => ({}) };
    const fourk = provider('fourk', 2, async () => [
      { url: 'https://x/4k', quality: '4K' },
    ]);
    const low = provider('low', 0, async () => [
      { url: 'https://x/1080-low', quality: '1080p' },
    ]);
    const high = provider('high', 1, async () => [
      { url: 'https://x/1080-high', quality: '1080p' },
    ]);
    const collector = makeCollector({ providers: [low, high, fourk], breaker, cache });

    const streams = await collector.collectStreams('tt3', 'movie', null, null);
    assert.deepStrictEqual(
      streams.map((stream) => stream.name),
      ['fourk', 'high', 'low']
    );
  });

  await checkAsync('collector opens a circuit after repeated timeouts', async () => {
    let calls = 0;
    const slow = provider('slow', 0, () => {
      calls += 1;
      return new Promise(() => {});
    });
    const breaker = createBreaker({ threshold: 3, cooldownMs: 60000 });
    const cache = createStreamCache({ ttlMs: 60000, maxEntries: 10 });
    const collector = makeCollector({ providers: [slow], breaker, cache });

    for (let i = 0; i < 3; i += 1) {
      const streams = await collector.collectStreams('tt4', 'movie', null, null);
      assert.deepStrictEqual(streams, []);
    }
    assert.strictEqual(calls, 3);

    const fourth = await collector.collectStreams('tt4', 'movie', null, null);
    assert.deepStrictEqual(fourth, []);
    assert.strictEqual(calls, 3);

    const stats = collector.getRuntimeStats();
    assert.strictEqual(stats.providers[0].state, 'open');
    assert.strictEqual(stats.providers[0].timeouts, 3);
    assert.strictEqual(stats.providers[0].skipped, 1);
  });

  await checkAsync('runtime stats include circuit, cache, and metadata summaries', async () => {
    const source = provider('a', 0, async () => [
      { url: 'https://x/a', quality: '1080p' },
    ]);
    const collector = makeCollector({ providers: [source] });

    const initial = collector.getRuntimeStats();
    assert.strictEqual(initial.providers[0].calls, 0);
    assert.strictEqual(initial.providers[0].score, 0.5);

    await collector.collectStreams('tt5', 'movie', null, null);
    const stats = collector.getRuntimeStats();
    assert.strictEqual(stats.circuits.total, 1);
    assert.strictEqual(stats.providers[0].id, 'a');
    assert.strictEqual(stats.streamCache.sets, 1);
    assert.ok(stats.metadataCache);
  });

  console.log('runtime tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
