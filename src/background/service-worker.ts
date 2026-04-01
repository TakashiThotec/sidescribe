import { Message, PageInfo, SuicaTransaction, PageMemo, BankTransaction, CardBilling } from '../types';
import { getSettings } from '../utils/storage';
import { notion } from '../modules/notion';

// ── Side Panel をアイコンクリックで開く ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

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

    default:
      return { error: `Unknown action: ${message.action}` };
  }
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
