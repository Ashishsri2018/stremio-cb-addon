const { normalizeSubtitles, sizeBytesOf } = require('./filters');
const { isWebPage } = require('./lib/url-classifier');

const QUALITY_PATTERNS = [
  [/\b(4k|uhd|2160p?)\b/i, 0],
  [/\b1080p?\b/i, 1],
  [/\b720p?\b/i, 2],
  [/\b(480p?|360p?|sd)\b/i, 3],
  [/(\bcam\b|hdcam|\bcamrip\b|\bts\b|telesync)/i, 5],
];

function qualityRank(stream) {
  const text = `${stream.quality || ''} ${stream.title || ''} ${stream.name || ''}`;
  for (const [pattern, rank] of QUALITY_PATTERNS) {
    if (pattern.test(text)) return rank;
  }
  return 4;
}

function toStremioStream(stream, provider) {
  if (!stream) return null;

  const targetUrl = stream.url || stream.externalUrl;
  const hasInfoHash = typeof stream.infoHash === 'string' && stream.infoHash.length > 0;
  if (!targetUrl && !hasInfoHash) return null;

  const out = {
    name: provider.name,
    title: stream.description || stream.title || stream.name || 'Stream',
  };

  if (targetUrl) {
    if (isWebPage(targetUrl, stream)) {
      out.externalUrl = targetUrl;
    } else {
      out.url = targetUrl;
      const hints = {};
      const videoSize = sizeBytesOf(stream);
      if (videoSize != null) hints.videoSize = videoSize;
      if (stream.headers && typeof stream.headers === 'object' && Object.keys(stream.headers).length > 0) {
        hints.proxyHeaders = { request: stream.headers };
        hints.notWebReady = true;
      }
      if (stream.behaviorHints && stream.behaviorHints.bingeGroup) {
        hints.bingeGroup = stream.behaviorHints.bingeGroup;
      }
      if (Object.keys(hints).length > 0) out.behaviorHints = hints;

      const subtitles = normalizeSubtitles(stream.subtitles);
      if (subtitles.length > 0) out.subtitles = subtitles;
    }
  } else {
    out.infoHash = stream.infoHash;
    if (stream.fileIdx != null) out.fileIdx = stream.fileIdx;
  }

  return out;
}

module.exports = { isWebPage, qualityRank, toStremioStream };
