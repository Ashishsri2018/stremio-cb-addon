const assert = require('assert');
const {
  DEFAULT_CONFIG,
  normalizeConfig,
  encodeConfig,
  decodeConfig,
  streamPassesFilters,
  normalizeSubtitles,
  resolutionOf,
  sizeBytesOf,
} = require('../filters');
const { toStremioStream, isWebPage } = require('../format');
const { parseContentId, toContentId, tmdbIdOf } = require('../content-id');

function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

check('defaults are permissive', () => {
  assert.deepStrictEqual(normalizeConfig({}), DEFAULT_CONFIG);
  assert.strictEqual(normalizeConfig({ maxSizeGB: '0' }).maxSizeGB, null);
  assert.strictEqual(normalizeConfig({ maxSizeGB: '-1' }).maxSizeGB, null);
  assert.strictEqual(normalizeConfig({ maxSizeGB: '2.5' }).maxSizeGB, 2.5);
  assert.strictEqual(normalizeConfig({ maxRes: '9999' }).maxRes, 'any');
  assert.strictEqual(normalizeConfig({ subtitles: 'nope' }).subtitles, 'any');
});

check('config round-trips through base64url', () => {
  const config = { maxRes: '1080', maxSizeGB: 3.5, keepUnknown: false, subtitles: 'hi' };
  assert.deepStrictEqual(decodeConfig(encodeConfig(config)), config);
  assert.strictEqual(decodeConfig('abc'), null);
  assert.strictEqual(decodeConfig(Buffer.from('[1,2]').toString('base64url')), null);
  assert.strictEqual(decodeConfig(''), null);
});

check('content id parsing accepts imdb and tmdb ids', () => {
  assert.deepStrictEqual(parseContentId('tt0137523'), {
    source: 'imdb',
    id: 'tt0137523',
    season: null,
    episode: null,
  });
  assert.deepStrictEqual(parseContentId('tt0944947:1:2'), {
    source: 'imdb',
    id: 'tt0944947',
    season: 1,
    episode: 2,
  });
  assert.deepStrictEqual(parseContentId('tmdb:550'), {
    source: 'tmdb',
    id: 550,
    season: null,
    episode: null,
  });
  assert.deepStrictEqual(parseContentId('tmdb:1399:3:4'), {
    source: 'tmdb',
    id: 1399,
    season: 3,
    episode: 4,
  });
  assert.strictEqual(toContentId(parseContentId('tmdb:1399:3:4')), 'tmdb:1399');
  assert.strictEqual(toContentId(parseContentId('tt0137523')), 'tt0137523');
  assert.strictEqual(tmdbIdOf('tmdb:550'), 550);
  assert.strictEqual(tmdbIdOf('tt0137523'), null);
});

check('content id parsing rejects unsupported ids', () => {
  assert.strictEqual(parseContentId('tmdb:'), null);
  assert.strictEqual(parseContentId('tmdb:abc'), null);
  assert.strictEqual(parseContentId('kitsu:50074:1'), null);
  assert.strictEqual(parseContentId('tt0944947:1'), null);
  assert.strictEqual(parseContentId('ttabc'), null);
  assert.strictEqual(parseContentId(''), null);
  assert.strictEqual(parseContentId(null), null);
});

check('resolution detection', () => {
  assert.strictEqual(resolutionOf({ quality: '4K' }), 2160);
  assert.strictEqual(resolutionOf({ quality: '1080p' }), 1080);
  assert.strictEqual(resolutionOf({ title: 'Movie 1999 720p WEB-DL' }), 720);
  assert.strictEqual(resolutionOf({ quality: 'SD' }), 480);
  assert.strictEqual(resolutionOf({ title: 'Movie 360p' }), 360);
  assert.strictEqual(resolutionOf({ title: 'Unknown quality' }), null);
  assert.strictEqual(resolutionOf({ quality: 'constructor' }), null);
  assert.strictEqual(resolutionOf({ quality: '__proto__' }), null);
  assert.strictEqual(resolutionOf({ quality: 'hasOwnProperty' }), null);
});

check('size detection', () => {
  assert.strictEqual(sizeBytesOf({ size: '1.5 GB' }), Math.round(1.5 * 1024 ** 3));
  assert.strictEqual(sizeBytesOf({ title: 'Movie 700 MB' }), 700 * 1024 ** 2);
  assert.strictEqual(sizeBytesOf({ description: '2 TB pack' }), 2 * 1024 ** 4);
  assert.strictEqual(sizeBytesOf({ title: 'no size here' }), null);
});

check('max resolution filter', () => {
  const config = { ...DEFAULT_CONFIG, maxRes: '1080', keepUnknown: true };
  assert.strictEqual(streamPassesFilters({ quality: '1080p', title: '1080p' }, config), true);
  assert.strictEqual(streamPassesFilters({ quality: '720p', title: '720p' }, config), true);
  assert.strictEqual(streamPassesFilters({ quality: '4K', title: '4K' }, config), false);
  assert.strictEqual(streamPassesFilters({ title: 'no resolution' }, config), true);
  assert.strictEqual(
    streamPassesFilters({ title: 'no resolution' }, { ...config, keepUnknown: false }),
    false
  );
});

check('max size filter', () => {
  const config = { ...DEFAULT_CONFIG, maxSizeGB: 2, keepUnknown: true };
  assert.strictEqual(streamPassesFilters({ title: 'Movie 1.2 GB' }, config), true);
  assert.strictEqual(streamPassesFilters({ title: 'Movie 5 GB' }, config), false);
  assert.strictEqual(streamPassesFilters({ title: 'HLS stream' }, config), true);
  assert.strictEqual(
    streamPassesFilters({ title: 'HLS stream' }, { ...config, keepUnknown: false }),
    false
  );
});

check('subtitle normalization', () => {
  const tracks = normalizeSubtitles([
    { language: 'English', url: 'https://x.test/en.vtt' },
    { lang: 'Hindi', file: 'https://x.test/hi.vtt' },
    'https://x.test/raw.vtt',
    { label: 'Tamil', url: 'not-a-url' },
    null,
  ]);
  assert.deepStrictEqual(
    tracks.map((track) => track.lang),
    ['en', 'hi', 'und']
  );
  assert.strictEqual(tracks[0].id, 'https://x.test/en.vtt');
});

check('subtitle filter by language and presence', () => {
  const hindi = { subtitles: [{ language: 'Hindi', url: 'https://x.test/hi.vtt' }] };
  const english = { subtitles: [{ language: 'English', url: 'https://x.test/en.vtt' }] };
  const textSubs = { title: 'Movie 1080p EngSubs' };
  const none = { title: 'Movie 1080p' };

  assert.strictEqual(streamPassesFilters(hindi, { ...DEFAULT_CONFIG, subtitles: 'hi' }), true);
  assert.strictEqual(streamPassesFilters(hindi, { ...DEFAULT_CONFIG, subtitles: 'en' }), false);
  assert.strictEqual(streamPassesFilters(english, { ...DEFAULT_CONFIG, subtitles: 'en' }), true);
  assert.strictEqual(
    streamPassesFilters(textSubs, { ...DEFAULT_CONFIG, subtitles: 'required' }),
    true
  );
  assert.strictEqual(streamPassesFilters(none, { ...DEFAULT_CONFIG, subtitles: 'required' }), true);
  assert.strictEqual(
    streamPassesFilters(none, { ...DEFAULT_CONFIG, subtitles: 'required', keepUnknown: false }),
    false
  );
  assert.strictEqual(
    streamPassesFilters(
      { title: 'Movie Multi-Subs' },
      { ...DEFAULT_CONFIG, subtitles: 'multi' }
    ),
    true
  );

  const esubTitle = 'Fight.Club.2023.Hindi.720p.WEB-DL.DDP.5.1.E-Sub.- moviesdrives.com.mkv';
  assert.strictEqual(
    streamPassesFilters({ title: esubTitle }, { ...DEFAULT_CONFIG, subtitles: 'en' }),
    true
  );
  assert.strictEqual(
    streamPassesFilters(
      { title: 'Movie 720p E.Sub' },
      { ...DEFAULT_CONFIG, subtitles: 'en' }
    ),
    true
  );
});

check('formatter keeps subtitles and size hint for direct streams', () => {
  const out = toStremioStream(
    {
      url: 'https://x.test/stream.m3u8',
      title: 'Movie 1080p',
      size: '1.5 GB',
      subtitles: [{ language: 'English', url: 'https://x.test/en.vtt' }],
    },
    { name: 'TestProvider', order: 0 }
  );
  assert.strictEqual(out.url, 'https://x.test/stream.m3u8');
  assert.strictEqual(out.externalUrl, undefined);
  assert.deepStrictEqual(out.subtitles, [
    { id: 'https://x.test/en.vtt', url: 'https://x.test/en.vtt', lang: 'en' },
  ]);
  assert.strictEqual(out.behaviorHints.videoSize, Math.round(1.5 * 1024 ** 3));
  assert.strictEqual(out.name, 'TestProvider');
});

check('web page detection distinguishes video streams from web pages and embeds', () => {
  // Direct video streams
  assert.strictEqual(isWebPage('https://cdn.test/video.m3u8'), false);
  assert.strictEqual(isWebPage('https://cdn.test/video.mp4?token=123'), false);
  assert.strictEqual(isWebPage('https://cdn.test/video.mkv'), false);
  assert.strictEqual(isWebPage('https://cdn.test/video.mpd'), false);
  assert.strictEqual(isWebPage('https://cdn.test/download/abc123'), false);
  assert.strictEqual(
    isWebPage('https://b6a3a2c1.r2.cloudflarestorage.com/hub/file.mkv?X-Amz=1'),
    false
  );
  assert.strictEqual(
    isWebPage('https://video-downloads.googleusercontent.com/ADGPM2nyQWdv'),
    false
  );
  assert.strictEqual(isWebPage('https://pixeldrain.com/api/file/abc123'), false);

  // Web pages & embeds
  assert.strictEqual(isWebPage('https://rubystm.com/e/abc123.html'), true);
  assert.strictEqual(isWebPage('https://screenscape.me/embed?tmdb=1396'), true);
  assert.strictEqual(isWebPage('https://peachify.top/embed/tv/1396/1/1'), true);
  assert.strictEqual(isWebPage('https://web.nxsha.app/embed/tv/1396/1/1'), true);
  assert.strictEqual(isWebPage('https://filesforever.link/embed/abt92w4'), true);
  assert.strictEqual(isWebPage('https://moviesapi.to/movie/27205'), true);
  assert.strictEqual(isWebPage('https://hubcloud.ist/tg/go?id=xyz'), true);
  assert.strictEqual(isWebPage('https://cdn.test/archive.zip'), true);
  assert.strictEqual(isWebPage('https://cdn.test/archive.rar'), true);
  assert.strictEqual(
    isWebPage('https://custom.site/watch', { server: 'Ruby Stream [Embed]' }),
    true
  );
  assert.strictEqual(
    isWebPage('https://custom.site/watch', { externalUrl: 'https://custom.site/watch' }),
    true
  );
});

check('formatter maps web pages and embeds to externalUrl and omits url', () => {
  const embed = toStremioStream(
    {
      url: 'https://screenscape.me/embed?tmdb=1396&type=tv&s=1&e=1',
      title: 'Breaking Bad S01E01 1080p',
      size: '1.5 GB',
      headers: { Referer: 'https://screenscape.me' },
    },
    { name: 'MultiMovies', order: 1 }
  );
  assert.strictEqual(embed.externalUrl, 'https://screenscape.me/embed?tmdb=1396&type=tv&s=1&e=1');
  assert.strictEqual(embed.url, undefined);
  assert.strictEqual(embed.behaviorHints, undefined);
  assert.strictEqual(embed.name, 'MultiMovies');

  const zip = toStremioStream(
    {
      url: 'https://workers.dev/Stranger.Things.S01E01.mkv.zip',
      title: 'Stranger Things S01E01 [4KHDHub]',
    },
    { name: '4KHDHub', order: 2 }
  );
  assert.strictEqual(zip.externalUrl, 'https://workers.dev/Stranger.Things.S01E01.mkv.zip');
  assert.strictEqual(zip.url, undefined);

  const providerTagged = toStremioStream(
    {
      externalUrl: 'https://moviesapi.to/movie/27205',
      title: 'Inception 1080p',
    },
    { name: 'RedFlix', order: 3 }
  );
  assert.strictEqual(providerTagged.externalUrl, 'https://moviesapi.to/movie/27205');
  assert.strictEqual(providerTagged.url, undefined);
});

console.log('filter tests passed');
