const DEFAULT_CONFIG = Object.freeze({
  maxRes: 'any',
  maxSizeGB: null,
  keepUnknown: true,
  subtitles: 'any',
});

const RES_VALUES = new Set(['any', '2160', '1080', '720', '480']);
const SUBTITLE_VALUES = new Set(['any', 'required', 'en', 'hi', 'ta', 'te', 'ml', 'ja', 'multi']);
const MAX_CONFIG_LENGTH = 512;

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  let maxSizeGB = null;
  if (source.maxSizeGB != null && source.maxSizeGB !== '') {
    const value = Number(source.maxSizeGB);
    if (Number.isFinite(value) && value > 0) maxSizeGB = Math.min(value, 1024);
  }

  return {
    maxRes: RES_VALUES.has(source.maxRes) ? source.maxRes : DEFAULT_CONFIG.maxRes,
    maxSizeGB,
    keepUnknown: source.keepUnknown !== false,
    subtitles: SUBTITLE_VALUES.has(source.subtitles) ? source.subtitles : DEFAULT_CONFIG.subtitles,
  };
}

function encodeConfig(config) {
  return Buffer.from(JSON.stringify(normalizeConfig(config)), 'utf8').toString('base64url');
}

function decodeConfig(segment) {
  if (typeof segment !== 'string' || segment.length === 0 || segment.length > MAX_CONFIG_LENGTH) {
    return null;
  }
  try {
    const raw = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return normalizeConfig(raw);
  } catch {
    return null;
  }
}

const RES_PATTERNS = [
  [/\b(2160p?|4k|uhd)\b/i, 2160],
  [/\b1080p?\b/i, 1080],
  [/\b720p?\b/i, 720],
  [/\b(480p?|sd)\b/i, 480],
  [/\b360p?\b/i, 360],
];

const DIRECT_RES = Object.assign(Object.create(null), {
  '4k': 2160, '2160': 2160, '2160p': 2160,
  '1080': 1080, '1080p': 1080,
  '720': 720, '720p': 720,
  '480': 480, '480p': 480,
  '360': 360, '360p': 360,
});

function resolutionOf(stream) {
  const quality = String(stream.quality || '').trim().toLowerCase();
  if (Object.hasOwn(DIRECT_RES, quality)) return DIRECT_RES[quality];

  const text = [stream.quality, stream.title, stream.description, stream.name]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ');
  for (const [pattern, height] of RES_PATTERNS) {
    if (pattern.test(text)) return height;
  }
  return null;
}

const SIZE_UNITS = { tb: 1024 ** 4, gb: 1024 ** 3, mb: 1024 ** 2, kb: 1024 };

function sizeBytesOf(stream) {
  for (const value of [stream.size, stream.title, stream.description]) {
    if (typeof value !== 'string') continue;
    const match = value.match(/([\d.]+)\s*(tb|gb|mb|kb)\b/i);
    if (!match) continue;
    const amount = Number.parseFloat(match[1]);
    if (Number.isFinite(amount)) return Math.round(amount * SIZE_UNITS[match[2].toLowerCase()]);
  }
  return null;
}

const LANG_ALIASES = {
  en: 'en', eng: 'en', english: 'en',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  ta: 'ta', tam: 'ta', tamil: 'ta',
  te: 'te', tel: 'te', telugu: 'te',
  ml: 'ml', mal: 'ml', malayalam: 'ml',
  kn: 'kn', kan: 'kn', kannada: 'kn',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko',
  fr: 'fr', fre: 'fr', french: 'fr',
  es: 'es', spa: 'es', spanish: 'es',
  de: 'de', ger: 'de', german: 'de',
  ru: 'ru', rus: 'ru', russian: 'ru',
  ar: 'ar', ara: 'ar', arabic: 'ar',
  zh: 'zh', chi: 'zh', chinese: 'zh',
  multi: 'multi', multilingual: 'multi', mul: 'multi',
};

function langCode(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[._]/g, '-').split('-')[0];
  return LANG_ALIASES[key] || (key.length > 0 && key.length <= 3 ? key : 'und');
}

function normalizeSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  const result = [];
  for (const subtitle of subtitles) {
    if (!subtitle) continue;
    const url = typeof subtitle === 'string' ? subtitle : subtitle.url || subtitle.file || subtitle.src;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const label = subtitle.lang || subtitle.language || subtitle.label || subtitle.name || 'und';
    result.push({
      id: String(subtitle.id || url),
      url,
      lang: langCode(label),
    });
  }
  return result;
}

const SUBTITLE_WORD = /\b(subs?|subtitles?)\b|(?:eng|esub|hin|tamil|telugu|malayalam|japanese|multi)[- ]?subs?/i;
const LANG_TEXT = {
  en: 'eng(?:lish)?',
  hi: 'hin(?:di)?',
  ta: 'tam(?:il)?',
  te: 'tel(?:ugu)?',
  ml: 'mal(?:ayalam)?',
  ja: 'jap(?:anese)?|jpn',
};

function hasSubtitleText(stream, code) {
  const text = [stream.title, stream.description, stream.name]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ');
  if (!text) return false;

  if (code === 'required') return SUBTITLE_WORD.test(text);
  if (code === 'multi') return /multi[- ]?(?:subs?|subtitles?)/i.test(text);
  if (code === 'en' && /\be[-. ]?subs?\b/i.test(text)) return true;

  const lang = LANG_TEXT[code];
  if (!lang) return false;
  const pattern = new RegExp(
    `(?:${lang})[^a-z]{0,24}(?:subs?|subtitles?)|(?:subs?|subtitles?)[^a-z]{0,24}(?:${lang})`,
    'i'
  );
  return pattern.test(text);
}

function streamPassesFilters(stream, config) {
  if (!stream) return false;
  const cfg = config || DEFAULT_CONFIG;

  if (cfg.maxRes !== 'any') {
    const height = resolutionOf(stream);
    if (height == null) {
      if (!cfg.keepUnknown) return false;
    } else if (height > Number(cfg.maxRes)) {
      return false;
    }
  }

  if (cfg.maxSizeGB != null) {
    const bytes = sizeBytesOf(stream);
    if (bytes == null) {
      if (!cfg.keepUnknown) return false;
    } else if (bytes > cfg.maxSizeGB * 1024 ** 3) {
      return false;
    }
  }

  if (cfg.subtitles !== 'any') {
    const tracks = normalizeSubtitles(stream.subtitles);
    const codes = new Set(tracks.map((track) => track.lang));

    let matches = false;
    if (cfg.subtitles === 'required') {
      matches = tracks.length > 0 || hasSubtitleText(stream, 'required');
    } else if (cfg.subtitles === 'multi') {
      matches = codes.has('multi') || hasSubtitleText(stream, 'multi');
    } else {
      matches = codes.has(cfg.subtitles) || hasSubtitleText(stream, cfg.subtitles);
    }

    if (!matches) {
      const knownSubtitles = tracks.length > 0 || hasSubtitleText(stream, 'required');
      if (knownSubtitles || !cfg.keepUnknown) return false;
    }
  }

  return true;
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeConfig,
  encodeConfig,
  decodeConfig,
  streamPassesFilters,
  normalizeSubtitles,
  resolutionOf,
  sizeBytesOf,
};
