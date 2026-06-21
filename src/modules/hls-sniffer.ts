import { parseEncryptionKey, parseSegmentUrls } from './hls-downloader';

export type HlsDeliveryMode = 'direct' | 'capture-preferred';

export interface CaptureProgress {
  total: number;
  captured: number;
  ready: boolean;
  hasPlaylist: boolean;
  hasEndList: boolean;
  videoKey: string | null;
  mode: HlsDeliveryMode;
}

export function classifyHlsDeliveryMode(url: string): HlsDeliveryMode {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('vod-akm.') || hostname.includes('akamaized.net')) {
      return 'capture-preferred';
    }
  } catch {
    // ignore
  }
  return 'direct';
}

export function extractVideoPathKey(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/video\/([^/]+)\//i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function urlsBelongToSameVideo(a: string, b: string): boolean {
  const keyA = extractVideoPathKey(a);
  const keyB = extractVideoPathKey(b);
  if (keyA && keyB) return keyA === keyB;

  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.split('/').slice(0, 4).join('/') === right.pathname.split('/').slice(0, 4).join('/');
  } catch {
    return false;
  }
}

export function normalizeResourceUrl(url: string, baseUrl?: string): string {
  try {
    return new URL(url, baseUrl || undefined).toString();
  } catch {
    return url;
  }
}

export function segmentPathKey(url: string, baseUrl?: string): string {
  try {
    const parsed = new URL(url, baseUrl || undefined);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

export function segmentMapsMatch(playlistSegmentUrl: string, capturedUrl: string, playlistUrl: string): boolean {
  return segmentPathKey(playlistSegmentUrl, playlistUrl) === segmentPathKey(capturedUrl);
}

export function findCapturedSegmentBuffer(
  playlistSegmentUrl: string,
  playlistUrl: string,
  segmentBuffers: Map<string, ArrayBuffer>
): ArrayBuffer | undefined {
  const targetKey = segmentPathKey(playlistSegmentUrl, playlistUrl);
  for (const [capturedUrl, buffer] of segmentBuffers.entries()) {
    if (segmentPathKey(capturedUrl) === targetKey) {
      return buffer;
    }
  }
  return undefined;
}

export function countCapturedSegments(
  orderedSegments: string[],
  playlistUrl: string,
  segmentBuffers: Map<string, ArrayBuffer>
): number {
  return orderedSegments.filter((segmentUrl) => findCapturedSegmentBuffer(segmentUrl, playlistUrl, segmentBuffers) !== undefined).length;
}

export function isHlsCaptureTargetUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('.ts') || lower.includes('.m4s') || lower.includes('.aac');
}

export function pickBestMediaPlaylist(
  streamUrl: string,
  playlists: Map<string, string>
): { url: string; text: string } | null {
  const candidates = [...playlists.entries()]
    .filter(([url, text]) => urlsBelongToSameVideo(url, streamUrl) && parseSegmentUrls(text, url).length > 0)
    .map(([url, text]) => ({
      url,
      text,
      segmentCount: parseSegmentUrls(text, url).length,
      bandwidth: estimatePlaylistBandwidth(text),
    }));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.bandwidth - a.bandwidth || b.segmentCount - a.segmentCount);
  const best = candidates[0];
  return { url: best.url, text: best.text };
}

export function computeCaptureProgress(
  streamUrl: string,
  playlists: Map<string, string>,
  segmentBuffers: Map<string, ArrayBuffer>
): CaptureProgress {
  const mode = classifyHlsDeliveryMode(streamUrl);
  const videoKey = extractVideoPathKey(streamUrl);
  const media = pickBestMediaPlaylist(streamUrl, playlists);

  if (!media) {
    return {
      total: 0,
      captured: 0,
      ready: false,
      hasPlaylist: false,
      hasEndList: false,
      videoKey,
      mode,
    };
  }

  const orderedSegments = parseSegmentUrls(media.text, media.url);
  const captured = countCapturedSegments(orderedSegments, media.url, segmentBuffers);
  const hasEndList = media.text.includes('#EXT-X-ENDLIST');

  return {
    total: orderedSegments.length,
    captured,
    ready: hasEndList && captured > 0 && captured >= orderedSegments.length,
    hasPlaylist: true,
    hasEndList,
    videoKey,
    mode,
  };
}

export function resolveCaptureSegmentBuffers(
  streamUrl: string,
  playlists: Map<string, string>,
  segmentBuffers: Map<string, ArrayBuffer>
): { playlistUrl: string; playlistText: string; buffers: ArrayBuffer[] } | null {
  const media = pickBestMediaPlaylist(streamUrl, playlists);
  if (!media) return null;

  const orderedSegments = parseSegmentUrls(media.text, media.url);
  const buffers: ArrayBuffer[] = [];

  for (const segmentUrl of orderedSegments) {
    const buffer = findCapturedSegmentBuffer(segmentUrl, media.url, segmentBuffers);
    if (!buffer) return null;
    buffers.push(buffer);
  }

  return {
    playlistUrl: media.url,
    playlistText: media.text,
    buffers,
  };
}

export function getEncryptionKeyFromPlaylist(playlistText: string, playlistUrl: string) {
  return parseEncryptionKey(playlistText, playlistUrl);
}

function estimatePlaylistBandwidth(playlistText: string): number {
  const match = playlistText.match(/BANDWIDTH=(\d+)/i);
  return match ? Number(match[1]) : 0;
}
