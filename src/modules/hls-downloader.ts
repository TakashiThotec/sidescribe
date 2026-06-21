export function selectBestVariantPlaylist(playlistText: string, playlistUrl: string): string | null {
  const lines = getContentLines(playlistText);
  let bestBandwidth = -1;
  let bestUrl: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;

    const nextLine = lines[i + 1];
    if (!nextLine || nextLine.startsWith('#')) continue;

    const bandwidth = parseBandwidth(line);
    if (bandwidth > bestBandwidth) {
      bestBandwidth = bandwidth;
      bestUrl = resolveHlsUrl(nextLine, playlistUrl);
    }
  }

  return bestUrl;
}

export function parseSegmentUrls(playlistText: string, playlistUrl: string): string[] {
  return getContentLines(playlistText)
    .filter((line) => !line.startsWith('#'))
    .map((line) => resolveHlsUrl(line, playlistUrl));
}

export function classifyPlaylistSupport(playlistText: string, playlistUrl: string): {
  supported: boolean;
  reason: string;
  segmentCount: number;
  encrypted: boolean;
} {
  const segmentCount = parseSegmentUrls(playlistText, playlistUrl).length;
  const encryptionKey = parseEncryptionKey(playlistText, playlistUrl);

  if (segmentCount === 0) {
    return { supported: false, reason: '動画セグメントが見つかりません', segmentCount, encrypted: !!encryptionKey };
  }

  if (encryptionKey) {
    return { supported: true, reason: 'DL可能 (AES-128)', segmentCount, encrypted: true };
  }

  return { supported: true, reason: 'DL可能', segmentCount, encrypted: false };
}

export interface HlsEncryptionKey {
  method: 'AES-128';
  uri: string;
  ivHex?: string;
  mediaSequence: number;
}

export function parseEncryptionKey(playlistText: string, playlistUrl: string): HlsEncryptionKey | null {
  const keyLine = getContentLines(playlistText).find((line) => line.startsWith('#EXT-X-KEY'));
  if (!keyLine || !keyLine.includes('METHOD=AES-128')) return null;

  const uri = parseAttribute(keyLine, 'URI');
  if (!uri) return null;

  const iv = parseAttribute(keyLine, 'IV');
  return {
    method: 'AES-128',
    uri: resolveHlsUrl(uri, playlistUrl),
    ivHex: iv ? iv.replace(/^0x/i, '').padStart(32, '0') : undefined,
    mediaSequence: parseMediaSequence(playlistText),
  };
}

export function getSegmentIvHex(key: Pick<HlsEncryptionKey, 'ivHex'> & { mediaSequence?: number }, segmentIndex: number): string {
  if (key.ivHex) return key.ivHex;
  const sequence = (key.mediaSequence || 0) + segmentIndex;
  return sequence.toString(16).padStart(32, '0');
}

export function createDownloadFilename(pageTitle: string): string {
  const sanitized = pageTitle
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return `${sanitized || 'sidescribe-video'}.ts`;
}

export interface HlsUrlExpiryInfo {
  expiresAtMs: number | null;
  state: 'unknown' | 'valid' | 'expiring' | 'expired';
  label: string;
}

export function describeHlsUrlExpiry(url: string, nowMs = Date.now()): HlsUrlExpiryInfo {
  const expiresAtMs = extractHlsUrlExpiryMs(url);
  if (!expiresAtMs) {
    return { expiresAtMs: null, state: 'unknown', label: '署名期限: 不明' };
  }

  const diffMs = expiresAtMs - nowMs;
  const expiresAtLabel = new Date(expiresAtMs).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (diffMs <= 0) {
    return { expiresAtMs, state: 'expired', label: `署名期限切れ: ${expiresAtLabel}` };
  }

  const remainingSeconds = Math.ceil(diffMs / 1000);
  if (remainingSeconds <= 120) {
    return { expiresAtMs, state: 'expiring', label: `署名期限間近: ${expiresAtLabel} あと${remainingSeconds}秒` };
  }

  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  return { expiresAtMs, state: 'valid', label: `署名期限: ${expiresAtLabel} あと約${remainingMinutes}分` };
}

function getContentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseBandwidth(streamInfLine: string): number {
  const match = streamInfLine.match(/BANDWIDTH=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function parseAttribute(line: string, name: string): string | null {
  const match = line.match(new RegExp(`${name}=("[^"]+"|[^,]+)`, 'i'));
  if (!match) return null;
  return match[1].replace(/^"|"$/g, '');
}

function parseMediaSequence(text: string): number {
  const line = getContentLines(text).find((item) => item.startsWith('#EXT-X-MEDIA-SEQUENCE'));
  const value = line?.split(':')[1];
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveHlsUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

function extractHlsUrlExpiryMs(url: string): number | null {
  try {
    const parsed = new URL(url);
    const directExp = parseEpochSeconds(parsed.searchParams.get('exp'));
    if (directExp) return directExp * 1000;

    const policyExp = parseCloudFrontPolicyExpiry(
      parsed.searchParams.get('Policy') || parsed.searchParams.get('Policy-cf')
    );
    if (policyExp) return policyExp * 1000;

    const tokenValues = [
      parsed.searchParams.get('hdnts'),
      parsed.searchParams.get('hdntl'),
    ].filter((value): value is string => !!value);

    for (const value of tokenValues) {
      const expMatch = value.match(/(?:^|[~&])exp=(\d{10})(?:$|[~&])/);
      const tokenExp = parseEpochSeconds(expMatch?.[1] || null);
      if (tokenExp) return tokenExp * 1000;
    }
  } catch {
    return null;
  }

  return null;
}

function parseEpochSeconds(value: string | null): number | null {
  if (!value || !/^\d{10}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCloudFrontPolicyExpiry(policy: string | null): number | null {
  if (!policy) return null;

  try {
    const normalized = policy
      .replace(/-/g, '+')
      .replace(/_/g, '=')
      .replace(/~/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = decodeBase64(padded);
    const policyJson = JSON.parse(decoded) as {
      Statement?: Array<{
        Condition?: {
          DateLessThan?: {
            'AWS:EpochTime'?: number;
          };
        };
      }>;
    };

    const expiresAt = policyJson.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime'];
    return typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): string {
  if (typeof atob === 'function') {
    return atob(value);
  }

  const bufferCtor = (globalThis as any).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, 'base64').toString('utf8');
  }

  throw new Error('Base64 decoder is not available');
}
