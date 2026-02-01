import { Message } from '../types';

// ── メッセージリスナー ──
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.action) {
    case 'EXTRACT_BANK_DATA':
      sendResponse(extractBankData());
      break;

    case 'EXTRACT_CARD_DATA':
      sendResponse(extractCardData());
      break;

    default:
      sendResponse({ error: `Unknown content action: ${message.action}` });
  }
  return true;
});

// ── 住信SBIネット銀行 ──
function extractBankData() {
  const hostname = window.location.hostname;
  if (!hostname.includes('netbk.co.jp')) {
    return { error: 'Not on SBI Net Bank page' };
  }

  // TODO: 入出金明細テーブルのDOM解析を実装
  return { data: [], message: 'SBI extraction not yet implemented' };
}

// ── カード明細 ──
function extractCardData() {
  // TODO: 各カード会社ごとの抽出ロジックを実装
  return { data: [], message: 'Card extraction not yet implemented' };
}

console.log('[Sidescribe] Content script loaded on:', window.location.hostname);
