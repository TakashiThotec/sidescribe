import { DetectedHlsStream, Message, PageInfo, SuicaTransaction, PageMemo, BankTransaction, CardBilling } from '../types';
import { getSettings } from '../utils/storage';
import { notion } from '../modules/notion';
import { registerMobileWindowListeners } from './mobile-window';
import { createDetectedHlsStream, isM3u8Url, isMissingTabError, isUrlAllowedByPatterns } from './hls-detector';

// ── Side Panel をアイコンクリックで開く ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ── スマホ表示 自動切替（対象ドメインのウィンドウリサイズ）──
registerMobileWindowListeners();

// ── HLS 動画ソース検知 ──
registerHlsDetectionListeners();

// ログを出さない非致命的エラー
const SILENT_ERRORS = [
  'No active tab found',
  'is not configured',
];

function isSilentError(message: string): boolean {
  return SILENT_ERRORS.some((pattern) => message.includes(pattern));
}

// ── メッセージハンドラ ──
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    // 非致命的エラーはログを出さない
    if (!isSilentError(err.message)) {
      console.error('[Sidescribe] Error:', err);
    }
    sendResponse({ error: err.message });
  });
  return true; // 非同期レスポンスを有効化
});

async function handleMessage(message: Message, sender: chrome.runtime.MessageSender) {
  const settings = await getSettings();
  notion.setApiKey(settings.notionApiKey);

  switch (message.action) {
    case 'GET_PAGE_INFO':
      return getActiveTabInfo();

    case 'SAVE_MEMO':
      return notion.saveMemo(
        settings.memoDatabaseId,
        message.payload as PageMemo,
        settings.memoDbMapping
      );

    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { success: true };

    case 'GET_DETECTED_HLS_STREAMS':
      return getDetectedHlsStreamsForActiveTab();

    case 'CLEAR_DETECTED_HLS_STREAMS':
      return clearDetectedHlsStreamsForActiveTab();

    // ── Suica ──
    case 'SAVE_SUICA_TRANSACTIONS': {
      const { transactions } = message.payload as { transactions: SuicaTransaction[] };
      if (!settings.suicaDatabaseId) {
        throw new Error('Suica Database ID is not configured');
      }
      const results = [];
      for (const tx of transactions) {
        const result = await notion.saveSuicaTransaction(
          settings.suicaDatabaseId,
          tx,
          settings.suicaDbMapping
        );
        results.push(result);
      }
      return { success: true, count: results.length };
    }

    // ── SBI Bank ──
    case 'GET_NOTION_BANK_DATA': {
      const { startDate, endDate } = message.payload as { startDate: string; endDate: string };
      if (!settings.bankTransactionDatabaseId) {
        throw new Error('Bank Transaction Database ID is not configured');
      }
      if (!settings.bankDbMapping?.dateProperty) {
        throw new Error('Bank Database date property mapping is not configured');
      }
      const transactions = await notion.getBankTransactions(
        settings.bankTransactionDatabaseId,
        startDate,
        endDate,
        settings.bankDbMapping
      );
      return { success: true, data: transactions };
    }

    case 'SAVE_BANK_TRANSACTIONS': {
      const { transactions } = message.payload as { transactions: BankTransaction[] };
      if (!settings.bankTransactionDatabaseId) {
        throw new Error('Bank Transaction Database ID is not configured');
      }
      const results = [];
      for (const tx of transactions) {
        const result = await notion.saveBankTransaction(
          settings.bankTransactionDatabaseId,
          tx,
          settings.bankDbMapping
        );
        results.push(result);
      }
      return { success: true, count: results.length };
    }

    // ── Card Billing ──
    case 'CHECK_CARD_BILLING_DUPLICATES': {
      const { billings } = message.payload as { billings: CardBilling[] };
      if (!settings.bankTransactionDatabaseId) {
        throw new Error('Bank Transaction Database ID is not configured');
      }
      if (!settings.bankDbMapping?.dateProperty) {
        throw new Error('Bank Database date property mapping is not configured');
      }

      // 各billing毎に重複チェック
      const duplicates: { billing: CardBilling; existingAmount?: number }[] = [];
      const newBillings: CardBilling[] = [];

      for (const billing of billings) {
        // 支払い日をYYYY-MM-DD形式に変換
        const currentYear = new Date().getFullYear();
        const dateMatch = billing.paymentDate.match(/(\d{1,2})月(\d{1,2})日/);
        if (!dateMatch) {
          newBillings.push(billing);
          continue;
        }

        const month = String(parseInt(dateMatch[1])).padStart(2, '0');
        const day = String(parseInt(dateMatch[2])).padStart(2, '0');
        const targetDate = `${currentYear}-${month}-${day}`;

        // その日の銀行明細を取得
        const transactions = await notion.getBankTransactions(
          settings.bankTransactionDatabaseId,
          targetDate,
          targetDate,
          settings.bankDbMapping
        );

        // 同じ日付・同じ金額の出金があるかチェック
        const duplicate = transactions.find(
          tx => tx.withdrawal != null && tx.withdrawal === billing.amount
        );

        if (duplicate) {
          duplicates.push({ billing, existingAmount: duplicate.withdrawal });
        } else {
          newBillings.push(billing);
        }
      }

      return { success: true, duplicates, newBillings };
    }

    case 'SAVE_CARD_BILLING': {
      const { billings } = message.payload as { billings: CardBilling[] };
      if (!settings.bankTransactionDatabaseId) {
        throw new Error('Bank Transaction Database ID is not configured');
      }
      const results = [];
      for (const billing of billings) {
        const result = await notion.saveCardBilling(
          settings.bankTransactionDatabaseId,
          billing,
          settings.bankDbMapping
        );
        results.push(result);
      }
      return { success: true, count: results.length };
    }

    case 'GET_CALENDAR_EVENTS': {
      const { startDate, endDate } = message.payload as { startDate: string; endDate: string };
      if (!settings.calendarDatabaseId) {
        throw new Error('Calendar Database ID is not configured');
      }
      if (!settings.calendarDbMapping?.dateProperty) {
        throw new Error('Calendar Database date property mapping is not configured');
      }
      const events = await notion.getCalendarEvents(
        settings.calendarDatabaseId,
        startDate,
        endDate,
        settings.calendarDbMapping
      );
      return { success: true, data: events };
    }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

function registerHlsDetectionListeners() {
  chrome.action.setBadgeBackgroundColor({ color: '#7c5cbf' });

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      void handleHlsRequest(details);
    },
    { urls: ['*://*/*.m3u8*'] }
  );

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void clearDetectedHlsStreamsForTab(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearDetectedHlsStreamsForTab(tabId);
  });
}

async function handleHlsRequest(details: chrome.webRequest.WebRequestBodyDetails) {
  if (details.tabId < 0 || !isM3u8Url(details.url)) return;

  const settings = await getSettings();
  const whitelistPatterns = settings.hlsWhitelistPatterns || [];
  if (whitelistPatterns.length === 0) return;

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch (err) {
    if (isMissingTabError(err)) return;
    throw err;
  }

  if (!tab.url || !isUrlAllowedByPatterns(tab.url, whitelistPatterns)) return;
  const detailExtras = details as chrome.webRequest.WebRequestBodyDetails & {
    documentUrl?: string;
    initiator?: string;
  };

  const stream = createDetectedHlsStream({
    requestUrl: details.url,
    pageUrl: tab.url,
    pageTitle: tab.title || '',
    tabId: details.tabId,
    frameId: details.frameId,
    frameUrl: detailExtras.documentUrl,
    initiator: detailExtras.initiator,
    detectedAt: Date.now(),
  });

  await upsertDetectedHlsStream(stream);
  void injectHlsSniffer(details.tabId, details.frameId);
}

async function injectHlsSniffer(tabId: number, frameId: number) {
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: () => !!(globalThis as { __SIDESCRIBE_HLS_SNIFFER__?: { installed?: boolean } }).__SIDESCRIBE_HLS_SNIFFER__?.installed,
    });
    if (check?.result) return;

    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      files: ['hls-sniffer-main.js'],
    });
  } catch (err) {
    if (!isMissingTabError(err)) {
      console.warn('[Sidescribe] HLS sniffer injection skipped:', err);
    }
  }
}

function getHlsStorageKey(tabId: number): string {
  return `hlsDetectedStreams:${tabId}`;
}

async function getDetectedHlsStreamsForTab(tabId: number): Promise<DetectedHlsStream[]> {
  const key = getHlsStorageKey(tabId);
  const result = await chrome.storage.session.get({ [key]: [] });
  return result[key] as DetectedHlsStream[];
}

async function setDetectedHlsStreamsForTab(tabId: number, streams: DetectedHlsStream[]) {
  const key = getHlsStorageKey(tabId);
  await chrome.storage.session.set({ [key]: streams });
  await updateHlsBadge(tabId, streams.length);
}

async function upsertDetectedHlsStream(stream: DetectedHlsStream) {
  const streams = await getDetectedHlsStreamsForTab(stream.tabId);
  const existingIndex = streams.findIndex((item) => item.id === stream.id);

  if (existingIndex >= 0) {
    streams[existingIndex] = stream;
  } else {
    streams.push(stream);
  }

  await setDetectedHlsStreamsForTab(stream.tabId, streams);
}

async function getActiveTabId(): Promise<number> {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}

async function getDetectedHlsStreamsForActiveTab() {
  const tabId = await getActiveTabId();
  const streams = await getDetectedHlsStreamsForTab(tabId);
  await updateHlsBadge(tabId, streams.length);
  return { success: true, data: streams };
}

async function clearDetectedHlsStreamsForActiveTab() {
  const tabId = await getActiveTabId();
  await clearDetectedHlsStreamsForTab(tabId);
  return { success: true };
}

async function clearDetectedHlsStreamsForTab(tabId: number) {
  await chrome.storage.session.remove(getHlsStorageKey(tabId));
  await updateHlsBadge(tabId, 0);
}

async function updateHlsBadge(tabId: number, count: number) {
  await chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(Math.min(count, 99)) : '',
  });
}

async function getActiveTabInfo(): Promise<PageInfo> {
  // まず currentWindow を試す
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // なければ lastFocusedWindow を試す（Service Workerコンテキストではこちらが有効なことがある）
  if (!tab?.url) {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }

  if (!tab?.url) {
    throw new Error('No active tab found');
  }
  const url = new URL(tab.url);
  return {
    url: tab.url,
    title: tab.title || '',
    hostname: url.hostname,
  };
}
