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
const { toStremioStream } = require('../format');

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
});

check('formatter keeps subtitles and size hint', () => {
  const out = toStremioStream(
    {
      url: 'https://x.test/stream.m3u8',
      title: 'Movie 1080p',
      size: '1.5 GB',
      subtitles: [{ language: 'English', url: 'https://x.test/en.vtt' }],
    },
    { name: 'TestProvider', order: 0 }
  );
  assert.deepStrictEqual(out.subtitles, [
    { id: 'https://x.test/en.vtt', url: 'https://x.test/en.vtt', lang: 'en' },
  ]);
  assert.strictEqual(out.behaviorHints.videoSize, Math.round(1.5 * 1024 ** 3));
  assert.strictEqual(out.name, 'TestProvider');
});

console.log('filter tests passed');
