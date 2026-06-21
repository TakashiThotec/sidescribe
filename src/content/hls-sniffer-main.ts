import {
  computeCaptureProgress,
  extractVideoPathKey,
  getEncryptionKeyFromPlaylist,
  isHlsCaptureTargetUrl,
  normalizeResourceUrl,
  resolveCaptureSegmentBuffers,
  segmentPathKey,
  urlsBelongToSameVideo,
} from '../modules/hls-sniffer';
import { createDownloadFilename, getSegmentIvHex } from '../modules/hls-downloader';

interface SnifferExportInput {
  streamUrl: string;
  pageTitle: string;
  streamId: string;
}

interface SnifferStatus {
  installed: boolean;
  total: number;
  captured: number;
  ready: boolean;
  hasPlaylist: boolean;
  hasEndList: boolean;
}

interface SidescribeSnifferApi {
  installed: boolean;
  getStatus: (streamUrl: string) => SnifferStatus;
  exportDownload: (input: SnifferExportInput) => Promise<{ success: boolean; error?: string; filename?: string }>;
  clearCapture: (streamUrl?: string) => void;
}

interface SidescribeWindow extends Window {
  __SIDESCRIBE_HLS_SNIFFER__?: SidescribeSnifferApi;
}

interface XhrWithSidescribeMeta extends XMLHttpRequest {
  _ssUrl?: string;
}

const playlists = new Map<string, string>();
const segmentBuffers = new Map<string, ArrayBuffer>();
const keyBuffers = new Map<string, ArrayBuffer>();
let activeStreamId = '';
let activeStreamUrl = '';

function emitProgress(streamId: string, status: string) {
  if (!streamId) return;
  window.postMessage({
    source: 'SIDESCRIBE_HLS_PROGRESS',
    streamId,
    status,
  }, '*');
}

function rememberText(url: string, text: string) {
  const normalized = normalizeResourceUrl(url);
  playlists.set(normalized, text);

  if (activeStreamUrl && urlsBelongToSameVideo(normalized, activeStreamUrl)) {
    const progress = computeCaptureProgress(activeStreamUrl, playlists, segmentBuffers);
    emitProgress(activeStreamId, `キャプチャ: ${progress.captured}/${progress.total} セグメント`);
  }
}

function rememberBinary(url: string, data: ArrayBuffer) {
  const normalized = normalizeResourceUrl(url);
  const lower = normalized.toLowerCase();

  if (lower.includes('.m3u8')) return;

  if (lower.includes('key') || lower.endsWith('.key')) {
    keyBuffers.set(normalized, data);
    return;
  }

  if (!lower.includes('.ts') && !lower.includes('.m4s') && !lower.includes('.aac')) return;

  segmentBuffers.set(segmentPathKey(normalized), data);

  if (activeStreamUrl && urlsBelongToSameVideo(normalized, activeStreamUrl)) {
    const progress = computeCaptureProgress(activeStreamUrl, playlists, segmentBuffers);
    emitProgress(activeStreamId, `キャプチャ: ${progress.captured}/${progress.total} セグメント`);
  }
}

async function captureFetchResponse(url: string, response: Response) {
  const normalized = normalizeResourceUrl(url);
  if (!isHlsCaptureTargetUrl(normalized)) return;

  try {
    if (normalized.toLowerCase().includes('.m3u8')) {
      rememberText(normalized, await response.text());
      return;
    }

    rememberBinary(normalized, await response.arrayBuffer());
  } catch {
    // ignore capture failures
  }
}

function captureXhrResponse(url: string, responseType: string, response: unknown) {
  const normalized = normalizeResourceUrl(url);
  if (!isHlsCaptureTargetUrl(normalized)) return;

  try {
    if (normalized.toLowerCase().includes('.m3u8')) {
      if (typeof response === 'string') {
        rememberText(normalized, response);
      } else if (response instanceof ArrayBuffer) {
        rememberText(normalized, new TextDecoder().decode(response));
      }
      return;
    }

    if (response instanceof ArrayBuffer) {
      rememberBinary(normalized, response);
    } else if (response instanceof Blob) {
      void response.arrayBuffer().then((buffer) => rememberBinary(normalized, buffer));
    }
  } catch {
    // ignore capture failures
  }
}

function installNetworkHooks() {
  if ((window as SidescribeWindow).__SIDESCRIBE_HLS_SNIFFER__?.installed) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    if (response.ok) {
      void captureFetchResponse(requestUrl, response.clone());
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    (this as XhrWithSidescribeMeta)._ssUrl = typeof url === 'string' ? url : url.toString();
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', function onLoad() {
      if (this.status < 200 || this.status >= 300) return;
      const xhrUrl = (this as XhrWithSidescribeMeta)._ssUrl;
      if (!xhrUrl) return;
      captureXhrResponse(xhrUrl, this.responseType, this.response);
    });
    return originalSend.call(this, body);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; streamUrl?: string; streamId?: string };
    if (data?.source !== 'SIDESCRIBE_HLS_SNIFFER_ARM') return;
    if (!data.streamUrl || !data.streamId) return;

    activeStreamUrl = data.streamUrl;
    activeStreamId = data.streamId;

    const progress = computeCaptureProgress(activeStreamUrl, playlists, segmentBuffers);
    emitProgress(activeStreamId, progress.total > 0
      ? `キャプチャ: ${progress.captured}/${progress.total} セグメント`
      : 'キャプチャ待機中（動画を再生してください）');
  });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function decryptSegments(
  playlistText: string,
  playlistUrl: string,
  buffers: ArrayBuffer[]
): Promise<ArrayBuffer[]> {
  const encryptionKey = getEncryptionKeyFromPlaylist(playlistText, playlistUrl);
  if (!encryptionKey) return buffers;

  const keyUrl = normalizeResourceUrl(encryptionKey.uri, playlistUrl);
  let rawKey = keyBuffers.get(keyUrl);
  if (!rawKey) {
    const response = await window.fetch(keyUrl, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`AES-128鍵取得失敗: HTTP ${response.status}`);
    rawKey = await response.arrayBuffer();
    keyBuffers.set(keyUrl, rawKey);
  }

  if (rawKey.byteLength !== 16) {
    throw new Error(`AES-128鍵長が不正です: ${rawKey.byteLength} bytes`);
  }

  const cryptoKey = await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted: ArrayBuffer[] = [];

  for (let index = 0; index < buffers.length; index++) {
    const ivBytes = hexToBytes(getSegmentIvHex(encryptionKey, index));
    decrypted.push(await window.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBytes as unknown as BufferSource },
      cryptoKey,
      buffers[index]
    ));
  }

  return decrypted;
}

function getStatus(streamUrl: string): SnifferStatus {
  const progress = computeCaptureProgress(streamUrl, playlists, segmentBuffers);
  return {
    installed: true,
    total: progress.total,
    captured: progress.captured,
    ready: progress.ready,
    hasPlaylist: progress.hasPlaylist,
    hasEndList: progress.hasEndList,
  };
}

async function exportDownload(input: SnifferExportInput): Promise<{ success: boolean; error?: string; filename?: string }> {
  try {
    activeStreamUrl = input.streamUrl;
    activeStreamId = input.streamId;

    const resolved = resolveCaptureSegmentBuffers(input.streamUrl, playlists, segmentBuffers);
    if (!resolved) {
      throw new Error('キャプチャ済みセグメントが不足しています。動画を最初から再生してください');
    }

    emitProgress(input.streamId, `復号・結合中: ${resolved.buffers.length} セグメント`);
    const segments = await decryptSegments(resolved.playlistText, resolved.playlistUrl, resolved.buffers);

    const filename = createDownloadFilename(input.pageTitle);
    const blob = new Blob(segments, { type: 'video/mp2t' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

    emitProgress(input.streamId, `保存を開始しました: ${filename}`);
    return { success: true, filename };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function belongsToStreamResource(resourceKey: string, streamUrl: string): boolean {
  if (resourceKey.startsWith('http')) {
    return urlsBelongToSameVideo(resourceKey, streamUrl);
  }

  const videoKey = extractVideoPathKey(streamUrl);
  return !!videoKey && resourceKey.includes(`/video/${videoKey}/`);
}

function clearCapture(streamUrl?: string) {
  if (!streamUrl) {
    playlists.clear();
    segmentBuffers.clear();
    keyBuffers.clear();
    return;
  }

  for (const url of [...playlists.keys()]) {
    if (belongsToStreamResource(url, streamUrl)) playlists.delete(url);
  }
  for (const url of [...segmentBuffers.keys()]) {
    if (belongsToStreamResource(url, streamUrl)) segmentBuffers.delete(url);
  }
  for (const url of [...keyBuffers.keys()]) {
    if (belongsToStreamResource(url, streamUrl)) keyBuffers.delete(url);
  }
}

const sidescribeWindow = window as SidescribeWindow;
if (!sidescribeWindow.__SIDESCRIBE_HLS_SNIFFER__?.installed) {
  installNetworkHooks();
  sidescribeWindow.__SIDESCRIBE_HLS_SNIFFER__ = {
    installed: true,
    getStatus,
    exportDownload,
    clearCapture,
  };
  console.log('[Sidescribe] HLS sniffer installed');
}
