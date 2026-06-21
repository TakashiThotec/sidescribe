import type { DetectedHlsStream } from '../types';

export function isM3u8Url(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

export function isUrlAllowedByPatterns(url: string, patterns: string[]): boolean {
  try {
    const target = new URL(url);
    return patterns.some((pattern) => matchUrlPattern(target, pattern.trim()));
  } catch {
    return false;
  }
}

export function createDetectedHlsStream(input: {
  requestUrl: string;
  pageUrl: string;
  pageTitle: string;
  tabId: number;
  frameId: number;
  frameUrl?: string;
  initiator?: string;
  detectedAt: number;
}): DetectedHlsStream {
  const normalizedRequestUrl = normalizeUrlForId(input.requestUrl);
  const page = new URL(input.pageUrl);

  return {
    id: `${input.tabId}:${normalizedRequestUrl}`,
    url: input.requestUrl,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    hostname: page.hostname,
    tabId: input.tabId,
    frameId: input.frameId,
    frameUrl: input.frameUrl,
    initiator: input.initiator,
    detectedAt: input.detectedAt,
  };
}

export function isMissingTabError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes('No tab with id:')
  );
}

function normalizeUrlForId(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function matchUrlPattern(target: URL, pattern: string): boolean {
  if (!pattern) return false;

  try {
    const normalizedPattern = pattern.includes('://') ? pattern : `https://${pattern}`;
    const parsedPattern = new URL(normalizedPattern);

    if (parsedPattern.protocol !== target.protocol) return false;
    if (!matchHostname(target.hostname, parsedPattern.hostname)) return false;

    const patternPath = parsedPattern.pathname || '/';
    return wildcardToRegExp(patternPath).test(target.pathname);
  } catch {
    return false;
  }
}

function matchHostname(hostname: string, patternHostname: string): boolean {
  if (patternHostname.startsWith('*.')) {
    const suffix = patternHostname.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === patternHostname;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
