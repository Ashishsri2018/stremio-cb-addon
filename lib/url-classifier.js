const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.m3u8',
  '.mpd',
  '.webm',
  '.avi',
  '.mov',
  '.flv',
  '.ts',
]);

const WEB_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.php',
  '.asp',
  '.aspx',
  '.jsp',
  '.cgi',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.iso',
]);

const EMBED_PATH_PATTERNS = [
  /\/embed(?:\/|\?|$)/i,
  /\/e\/[a-zA-Z0-9_-]+/i,
  /\/iframe(?:\/|\?|$)/i,
  /\/player(?:\/|\?|$)/i,
  /\/tg\/(?:go|bot)\b/i,
];

const KNOWN_EMBED_DOMAINS = [
  'moviesapi.to',
  'vidspark.to',
  'rubystm.com',
  'streamruby.net',
  'filesforever.link',
  'modiplay.xyz',
  'screenscape.me',
  'peachify.top',
  'nxsha.app',
  'nhdapi.com',
  'moviesnexus.fun',
  'vidrift.net',
  'vidout.pages.dev',
  'filmu.in',
  'vidbolt.xyz',
  'primesrc.',
  'xpass.',
  'vidrock.',
  'vaplayer.',
  'telegram.me',
  't.me',
];

function isWebPage(url, stream = {}) {
  if (typeof stream.externalUrl === 'string' && stream.externalUrl.length > 0) return true;
  if (typeof url !== 'string' || url.length === 0) return false;

  const textHint = `${stream.server || ''} ${stream.name || ''} ${stream.title || ''}`;
  if (/\[embed\]|\bembed\b/i.test(textHint)) {
    const cleanUrl = url.split('#')[0].split('?')[0];
    const hasVidExt = [...VIDEO_EXTENSIONS].some((ext) => cleanUrl.toLowerCase().endsWith(ext));
    if (!hasVidExt) return true;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  for (const ext of VIDEO_EXTENSIONS) {
    if (pathname.endsWith(ext)) return false;
  }

  if (
    hostname.endsWith('.r2.cloudflarestorage.com') ||
    hostname === 'video-downloads.googleusercontent.com' ||
    (hostname === 'pixeldrain.com' && pathname.startsWith('/api/file/'))
  ) {
    return false;
  }

  for (const ext of WEB_EXTENSIONS) {
    if (pathname.endsWith(ext)) return true;
  }

  const fullPathAndQuery = `${pathname}${parsed.search}`;
  for (const pattern of EMBED_PATH_PATTERNS) {
    if (pattern.test(fullPathAndQuery)) return true;
  }

  for (const domain of KNOWN_EMBED_DOMAINS) {
    if (hostname.includes(domain)) return true;
  }

  return false;
}

module.exports = { isWebPage };
