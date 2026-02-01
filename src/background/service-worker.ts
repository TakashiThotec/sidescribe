import { Message, PageInfo } from '../types';
import { getSettings } from '../utils/storage';
import { notion } from '../modules/notion';

// ── Side Panel をアイコンクリックで開く ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ── メッセージハンドラ ──
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[Sidescribe] Error:', err);
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
      return notion.saveMemo(settings.memoDatabaseId, message.payload as any);

    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { success: true };

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

async function getActiveTabInfo(): Promise<PageInfo> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
