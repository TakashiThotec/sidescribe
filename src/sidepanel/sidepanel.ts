import './sidepanel.css';
import { PageInfo, PageMemo } from '../types';
import { getSettings, isConfigured } from '../utils/storage';

// ── DOM Elements ──
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const pageHostname = $<HTMLSpanElement>('page-hostname');
const notConfigured = $<HTMLDivElement>('not-configured');
const memoTitle = $<HTMLInputElement>('memo-title');
const memoUrl = $<HTMLInputElement>('memo-url');
const memoNote = $<HTMLTextAreaElement>('memo-note');
const btnSaveMemo = $<HTMLButtonElement>('btn-save-memo');
const btnSettings = $<HTMLButtonElement>('btn-settings');
const linkSettings = $<HTMLAnchorElement>('link-settings');
const siteActions = $<HTMLElement>('site-actions');
const siteActionsContent = $<HTMLDivElement>('site-actions-content');
const toast = $<HTMLDivElement>('toast');

// ── Site-specific action definitions ──
interface SiteAction {
  hostname: string[];
  label: string;
  description: string;
  messageAction: string;
}

const SITE_ACTIONS: SiteAction[] = [
  {
    hostname: ['www.netbk.co.jp'],
    label: '💰 入出金履歴を取得',
    description: '住信SBIネット銀行の明細をNotionに保存',
    messageAction: 'EXTRACT_BANK_DATA',
  },
  // カード会社は今後追加
];

// ── Init ──
async function init() {
  const settings = await getSettings();

  // 設定チェック
  if (!isConfigured(settings)) {
    notConfigured.style.display = 'block';
  }

  // ページ情報を取得
  try {
    const pageInfo: PageInfo = await chrome.runtime.sendMessage({ action: 'GET_PAGE_INFO' });
    pageHostname.textContent = pageInfo.hostname;
    memoTitle.value = pageInfo.title;
    memoUrl.value = pageInfo.url;

    // サイト固有アクションの表示
    showSiteActions(pageInfo.hostname);
  } catch (err) {
    pageHostname.textContent = 'ページ情報を取得できません';
  }
}

// ── Site Actions ──
function showSiteActions(hostname: string) {
  const actions = SITE_ACTIONS.filter((a) => a.hostname.includes(hostname));
  if (actions.length === 0) return;

  siteActions.style.display = 'block';
  siteActionsContent.innerHTML = '';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.innerHTML = `
      <span class="action-label">${action.label}</span>
      <span class="action-desc">${action.description}</span>
    `;
    btn.addEventListener('click', () => handleSiteAction(action));
    siteActionsContent.appendChild(btn);
  }
}

async function handleSiteAction(action: SiteAction) {
  showToast('処理中...', 'success');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const result = await chrome.tabs.sendMessage(tab.id, { action: action.messageAction });
    if (result?.error) throw new Error(result.error);

    showToast('完了しました ✓', 'success');
  } catch (err: any) {
    showToast(`エラー: ${err.message}`, 'error');
  }
}

// ── Save Memo ──
btnSaveMemo.addEventListener('click', async () => {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    showToast('先にNotion APIキーを設定してください', 'error');
    return;
  }

  btnSaveMemo.disabled = true;

  const memo: PageMemo = {
    url: memoUrl.value,
    title: memoTitle.value,
    note: memoNote.value,
    createdAt: new Date().toISOString(),
  };

  try {
    await chrome.runtime.sendMessage({ action: 'SAVE_MEMO', payload: memo });
    showToast('メモを保存しました ✓', 'success');
    memoNote.value = '';
  } catch (err: any) {
    showToast(`保存エラー: ${err.message}`, 'error');
  } finally {
    btnSaveMemo.disabled = false;
  }
});

// ── Settings ──
btnSettings.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
});

linkSettings?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
});

// ── Toast ──
function showToast(message: string, type: 'success' | 'error') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// ── Tab切替時にページ情報を更新 ──
chrome.tabs.onActivated.addListener(() => init());

// ── Start ──
init();
