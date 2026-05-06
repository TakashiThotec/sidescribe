import './sidepanel.css';
import { PageInfo, PageMemo, TabType, SuicaTransaction, BankTransaction, CardBilling, CardBillingGroup, CardBillingStock, CalendarEvent } from '../types';
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

// Tab elements
const tabBar = $<HTMLDivElement>('tab-bar');
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab');
const tabContents = document.querySelectorAll<HTMLDivElement>('.tab-content');

// ── Tab Configuration ──
interface TabConfig {
  tab: TabType;
  hostnames: string[];
}

const TAB_CONFIGS: TabConfig[] = [
  { tab: 'suica', hostnames: ['www.mobilesuica.com', 'www.jreast.co.jp'] },
  { tab: 'sbi', hostnames: ['www.netbk.co.jp'] },
  { tab: 'card', hostnames: ['global.americanexpress.com', 'www.smbc-card.com'] },
  { tab: 'x', hostnames: ['x.com', 'twitter.com'] },
  { tab: 'ana', hostnames: ['ana.co.jp'] },
];

// ── Site-specific action definitions ──
interface SiteAction {
  hostname: string[];
  label: string;
  description: string;
  messageAction: string;
}

const SITE_ACTIONS: SiteAction[] = [
  // カード会社は今後追加
];

// ── Suica DOM Elements ──
const suicaStatus = $<HTMLDivElement>('suica-status');
const suicaStartDate = $<HTMLInputElement>('suica-start-date');
const suicaEndDate = $<HTMLInputElement>('suica-end-date');
const suicaReload = $<HTMLButtonElement>('suica-reload');
const suicaOutputFormat = $<HTMLSelectElement>('suica-output-format');
const suicaDateFormat = $<HTMLSelectElement>('suica-date-format');
const suicaEncoding = $<HTMLSelectElement>('suica-encoding');
const suicaCount = $<HTMLSpanElement>('suica-count');
const suicaExportCsv = $<HTMLButtonElement>('suica-export-csv');
const suicaPreviewArea = $<HTMLDivElement>('suica-preview-area');

// ── SBI DOM Elements ──
const sbiFetchPage = $<HTMLButtonElement>('sbi-fetch-page');
const sbiPageStatus = $<HTMLDivElement>('sbi-page-status');
const sbiPeriod = $<HTMLDivElement>('sbi-period');
const sbiFetchNotion = $<HTMLButtonElement>('sbi-fetch-notion');
const sbiNotionStatus = $<HTMLDivElement>('sbi-notion-status');
const sbiResultStep = $<HTMLDivElement>('sbi-result-step');
const sbiNewCount = $<HTMLSpanElement>('sbi-new-count');
const sbiExistingCount = $<HTMLSpanElement>('sbi-existing-count');
const sbiSelectAll = $<HTMLInputElement>('sbi-select-all');
const sbiNewList = $<HTMLDivElement>('sbi-new-list');
const sbiAddToNotion = $<HTMLButtonElement>('sbi-add-to-notion');
const sbiPreview = $<HTMLDivElement>('sbi-preview');

// ── Card DOM Elements ──
const cardFetchCurrent = $<HTMLButtonElement>('card-fetch-current');
const cardClearAll = $<HTMLButtonElement>('card-clear-all');
const cardCompanyInfo = $<HTMLDivElement>('card-company-info');
const cardGroupsContainer = $<HTMLDivElement>('card-groups-container');
const cardStatus = $<HTMLDivElement>('card-status');
const cardBatchSection = $<HTMLDivElement>('card-batch-section');
const cardBatchCount = $<HTMLSpanElement>('card-batch-count');
const cardBatchResult = $<HTMLDivElement>('card-batch-result');
const cardBatchNewCount = $<HTMLSpanElement>('card-batch-new-count');
const cardBatchDuplicateCount = $<HTMLSpanElement>('card-batch-duplicate-count');
const cardBatchCheck = $<HTMLButtonElement>('card-batch-check');
const cardBatchAdd = $<HTMLButtonElement>('card-batch-add');

// ── X/Twitter DOM Elements ──
const xStatus = $<HTMLDivElement>('x-status');
const xShowForYou = $<HTMLButtonElement>('x-show-foryou');
const xHideForYou = $<HTMLButtonElement>('x-hide-foryou');
const xRefresh = $<HTMLButtonElement>('x-refresh');
const xDebug = $<HTMLPreElement>('x-debug');

// ── Current State ──
let currentHostname = '';
let suicaTransactions: SuicaTransaction[] = [];
let suicaFilteredTransactions: SuicaTransaction[] = [];
let suicaSettings = {
  dateFormat: 'yyyy-mm-dd',
  encoding: 'utf-8',
  outputFormat: 'raw',
};

// ── SBI State ──
let sbiPageTransactions: BankTransaction[] = [];
let sbiNotionTransactions: BankTransaction[] = [];
let sbiNewTransactions: BankTransaction[] = [];
let sbiExistingTransactions: BankTransaction[] = [];
let sbiPeriodInfo = '';
let sbiSelectedTransactions: Set<number> = new Set();

// ── Card State ──
let cardBillingGroups: CardBillingGroup[] = [];
// 選択状態: Map<groupId, Set<billingIndex>>
let cardSelectedBillings: Map<string, Set<number>> = new Map();
// 重複チェック結果
let cardDuplicateResults: Map<string, { billing: CardBilling; isDuplicate: boolean }[]> = new Map();
let cardHasCheckedDuplicates = false;

// ── Content Script Injection ──
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // まずpingを送ってコンテンツスクリプトが存在するかチェック
    await chrome.tabs.sendMessage(tabId, { action: 'PING' });
  } catch {
    // コンテンツスクリプトがない場合、動的にインジェクト
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  }
}

async function sendMessageToTab<T>(tabId: number, message: any): Promise<T> {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

// ── Tab Functions ──
function getTabForHostname(hostname: string): TabType | null {
  for (const config of TAB_CONFIGS) {
    if (config.hostnames.some((h) => hostname.includes(h))) {
      return config.tab;
    }
  }
  return null;
}

function showTab(tabName: TabType) {
  // Update tab buttons
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab contents
  tabContents.forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

function updateTabVisibility(hostname: string) {
  const activeTab = getTabForHostname(hostname);

  // Show/hide tab buttons based on current site
  tabButtons.forEach((btn) => {
    const tabName = btn.dataset.tab as TabType;
    if (tabName === 'memo') {
      // メモタブは常に表示
      btn.style.display = '';
    } else if (tabName === activeTab) {
      // 該当サイトのタブを表示
      btn.style.display = '';
    } else {
      // その他のタブは非表示
      btn.style.display = 'none';
    }
  });

  // 該当サイトならそのタブを選択、そうでなければメモタブ
  showTab(activeTab || 'memo');
}

// ── Tab Click Handler ──
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab as TabType;
    showTab(tabName);
  });
});

// ── Init ──
async function init() {
  const settings = await getSettings();

  // ページ情報を取得
  try {
    const pageInfo: PageInfo = await chrome.runtime.sendMessage({ action: 'GET_PAGE_INFO' });
    currentHostname = pageInfo.hostname;
    pageHostname.textContent = pageInfo.hostname;
    memoTitle.value = pageInfo.title;
    memoUrl.value = pageInfo.url;

    // タブの表示/選択を更新
    updateTabVisibility(pageInfo.hostname);

    // サイト固有アクションの表示（タブがないサイト用）
    showSiteActions(pageInfo.hostname);

    // 設定チェック（Suicaタブは不要なので除外）
    const isSuicaSite = pageInfo.hostname.includes('jreast.co.jp') || pageInfo.hostname.includes('mobilesuica.com');
    const isSbiSite = pageInfo.hostname.includes('netbk.co.jp');
    const isCardSite = pageInfo.hostname.includes('americanexpress.com') || pageInfo.hostname.includes('smbc-card.com');
    
    if (isSuicaSite || isSbiSite) {
      notConfigured.style.display = 'none';
    } else if (!settings.notionApiKey) {
      notConfigured.innerHTML = 'Notion APIキーが未設定です。<a href="#" id="link-settings">設定画面を開く</a>';
      notConfigured.style.display = 'block';
      attachSettingsLink();
    } else if (!settings.memoDatabaseId) {
      notConfigured.innerHTML = 'メモ用のDatabase IDが未設定です。<a href="#" id="link-settings">設定画面を開く</a>';
      notConfigured.style.display = 'block';
      attachSettingsLink();
    } else {
      notConfigured.style.display = 'none';
    }

    // Suicaタブの初期化
    if (isSuicaSite) {
      initSuicaTab();
    }

    // SBIタブの初期化
    if (isSbiSite) {
      initSbiTab();
    }

    // カードタブの初期化（カードサイトのみ）
    if (isCardSite) {
      await initCardTab();
    }

    // X/Twitterの初期化
    const isXSite = pageInfo.hostname === 'x.com' || pageInfo.hostname === 'twitter.com';
    if (isXSite) {
      notConfigured.style.display = 'none';
      initXTab();
    }

    // ANAサイトの初期化（カレンダーを表示）
    const isAnaSite = pageInfo.hostname.includes('ana.co.jp');
    if (isAnaSite) {
      notConfigured.style.display = 'none';
      initAnaTab();
    }
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

    const result = await sendMessageToTab<{ error?: string }>(tab.id, { action: action.messageAction });
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
    const result = await chrome.runtime.sendMessage({ action: 'SAVE_MEMO', payload: memo });
    if (result?.error) {
      throw new Error(result.error);
    }
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

function attachSettingsLink() {
  const link = document.getElementById('link-settings');
  link?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
  });
}

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

// ── ページ遷移時にページ情報を更新 ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // アクティブなタブでURLが変わってロードが完了したとき
  if (changeInfo.status === 'complete' && tab.active) {
    init();
  }
});

// ── 設定変更時にUIを更新 ──
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    init();
  }
});

// ══════════════════════════════════════════════════════════
// X/Twitter Functions
// ══════════════════════════════════════════════════════════

async function xGetStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return await sendMessageToTab<{ success: boolean; data: any }>(tab.id, { action: 'X_GET_STATUS' });
  } catch {
    return null;
  }
}

async function xSendAction(action: string) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return await sendMessageToTab<{ success: boolean; data: { success: boolean; message: string } }>(tab.id, { action });
}

async function refreshXStatus() {
  if (!xStatus) return;
  xStatus.textContent = '確認中...';
  xStatus.className = 'x-status';

  const result = await xGetStatus();
  if (!result?.success) {
    xStatus.textContent = 'Content scriptに接続できません。ページを再読み込みしてください。';
    xStatus.className = 'x-status error';
    if (xDebug) xDebug.textContent = 'No response';
    return;
  }

  const data = result.data;
  const statusParts: string[] = [];
  if (data.forYouFound) statusParts.push(`おすすめ: ${data.forYouHidden ? '非表示' : '表示中'}`);
  else statusParts.push('おすすめ: 未検出');
  if (data.followingFound) statusParts.push('フォロー中: 検出済み');
  else statusParts.push('フォロー中: 未検出');
  statusParts.push(`アクティブ: ${data.activeTab}`);

  xStatus.textContent = statusParts.join(' / ');
  xStatus.className = 'x-status success';

  if (xDebug) xDebug.textContent = JSON.stringify(data, null, 2);
}

function initXTab() {
  refreshXStatus();

  xShowForYou?.addEventListener('click', async () => {
    try {
      const result = await xSendAction('X_SWITCH_TO_FOR_YOU');
      showToast(result.data.message, result.data.success ? 'success' : 'error');
      setTimeout(refreshXStatus, 500);
    } catch (err: any) {
      showToast(`エラー: ${err.message}`, 'error');
    }
  });

  xHideForYou?.addEventListener('click', async () => {
    try {
      const result = await xSendAction('X_HIDE_FOR_YOU');
      showToast(result.data.message, result.data.success ? 'success' : 'error');
      setTimeout(refreshXStatus, 500);
    } catch (err: any) {
      showToast(`エラー: ${err.message}`, 'error');
    }
  });

  xRefresh?.addEventListener('click', () => refreshXStatus());
}

// ══════════════════════════════════════════════════════════
// Suica Functions (suica-history-to-freee style)
// ══════════════════════════════════════════════════════════

// ── Suica Event Listeners ──
suicaReload?.addEventListener('click', () => loadSuicaData());
suicaExportCsv?.addEventListener('click', () => exportSuicaCsv());
suicaStartDate?.addEventListener('change', () => onSuicaPeriodChange());
suicaEndDate?.addEventListener('change', () => onSuicaPeriodChange());
suicaOutputFormat?.addEventListener('change', () => onSuicaSettingChange('outputFormat'));
suicaDateFormat?.addEventListener('change', () => onSuicaSettingChange('dateFormat'));
suicaEncoding?.addEventListener('change', () => onSuicaSettingChange('encoding'));

// ── Initialize Suica Tab ──
function initSuicaTab() {
  setDefaultSuicaPeriod();
  loadSuicaData();
}

// ── Set Default Period (前月1日〜月末) ──
function setDefaultSuicaPeriod() {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  // 前月の1日から月末まで
  const startDate = new Date(currentYear, currentMonth - 1, 1);
  const endDate = new Date(currentYear, currentMonth, 0); // 前月の最終日

  if (suicaStartDate) suicaStartDate.value = formatDateForInput(startDate);
  if (suicaEndDate) suicaEndDate.value = formatDateForInput(endDate);
}

// ── Format Date for Input ──
function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Show Suica Status ──
function showSuicaStatus(message: string, type: 'success' | 'error' | 'warning' | 'info') {
  if (!suicaStatus) return;
  suicaStatus.textContent = message;
  suicaStatus.className = `suica-status-inline ${type}`;
}

// ── Load Suica Data ──
async function loadSuicaData() {
  if (!currentHostname.includes('jreast.co.jp') && !currentHostname.includes('mobilesuica.com')) {
    showSuicaStatus('モバイルSuicaの利用履歴ページでデータを取得できます', 'info');
    if (suicaPreviewArea) {
      suicaPreviewArea.innerHTML = '<div class="suica-no-data">モバイルSuicaの利用履歴ページに移動してから「データ更新」ボタンを押してください。</div>';
    }
    return;
  }

  showSuicaStatus('データを取得中...', 'info');
  if (suicaPreviewArea) {
    suicaPreviewArea.innerHTML = '<div class="suica-no-data">データを取得中...</div>';
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const result = await sendMessageToTab<{ success: boolean; data: SuicaTransaction[]; error?: string }>(tab.id, { action: 'GET_SUICA_DATA' });
    if (!result?.success) throw new Error(result?.error || 'Failed to get Suica data');

    suicaTransactions = result.data;
    
    if (suicaTransactions.length === 0) {
      showSuicaStatus('データが見つかりませんでした。モバイルSuicaの利用履歴ページにアクセスしていることを確認してください。', 'warning');
    } else {
      processAndFilterSuicaData();
      displaySuicaPreview();
    }
  } catch (err: any) {
    showSuicaStatus(`データ取得中にエラーが発生しました: ${err.message}`, 'error');
    if (suicaPreviewArea) {
      suicaPreviewArea.innerHTML = `<div class="suica-no-data" style="color: #721c24;">${err.message}</div>`;
    }
  }
}

// ── Process and Filter Suica Data ──
function processAndFilterSuicaData() {
  const startDateValue = suicaStartDate?.value;
  const endDateValue = suicaEndDate?.value;
  
  if (!startDateValue || !endDateValue) {
    suicaFilteredTransactions = suicaTransactions;
    return;
  }

  const startDate = new Date(startDateValue);
  const endDate = new Date(endDateValue);

  // 期間に基づいてデータをフィルタリング
  suicaFilteredTransactions = suicaTransactions.filter((tx) => {
    const recordDate = new Date(tx.date);
    
    // 期間チェック
    if (recordDate < startDate || recordDate > endDate) {
      return false;
    }
    
    // 金額チェック（0円の取引は除外）
    if (tx.amount === 0) {
      return false;
    }
    
    return true;
  });

  // ボタンの状態を更新
  const hasData = suicaFilteredTransactions.length > 0;
  if (suicaExportCsv) suicaExportCsv.disabled = !hasData;
  if (suicaCount) suicaCount.textContent = `${suicaFilteredTransactions.length}件`;

  if (hasData) {
    showSuicaStatus(`${suicaFilteredTransactions.length}件のデータを取得しました（全${suicaTransactions.length}件中）`, 'success');
  } else {
    showSuicaStatus('指定した条件に一致するデータがありません', 'warning');
  }
}

// ── Display Suica Preview (Table format) ──
function displaySuicaPreview() {
  if (!suicaPreviewArea) return;

  if (suicaFilteredTransactions.length === 0) {
    suicaPreviewArea.innerHTML = '<div class="suica-no-data">条件に一致するデータがありません</div>';
    return;
  }

  // プレビュー用のテーブルを作成
  let tableHtml = `
    <table class="suica-preview-table">
      <thead>
        <tr>
          <th>取引日</th>
          <th>取引金額</th>
          <th>取引内容</th>
          <th>残高</th>
        </tr>
      </thead>
      <tbody>
  `;

  // 最大10件表示
  const displayData = suicaFilteredTransactions.slice(0, 10);
  displayData.forEach((tx) => {
    const amountClass = tx.amount < 0 ? 'amount-negative' : 'amount-positive';
    const balanceNum = tx.balance ? parseInt(tx.balance, 10) : null;
    const balanceStr = balanceNum !== null && !isNaN(balanceNum) ? `${balanceNum.toLocaleString()}円` : '-';
    tableHtml += `
      <tr>
        <td>${tx.date}</td>
        <td class="${amountClass}">${tx.amount.toLocaleString()}円</td>
        <td>${tx.details}</td>
        <td>${balanceStr}</td>
      </tr>
    `;
  });

  if (suicaFilteredTransactions.length > 10) {
    tableHtml += `<tr><td colspan="4" style="text-align: center; font-style: italic; color: #6c757d;">...他 ${suicaFilteredTransactions.length - 10} 件</td></tr>`;
  }

  tableHtml += '</tbody></table>';
  suicaPreviewArea.innerHTML = tableHtml;
}

// ── On Suica Period Change ──
function onSuicaPeriodChange() {
  if (suicaTransactions.length > 0) {
    processAndFilterSuicaData();
    displaySuicaPreview();
  }
}

// ── On Suica Setting Change ──
function onSuicaSettingChange(settingId: string) {
  let element: HTMLSelectElement | null = null;
  
  if (settingId === 'outputFormat') element = suicaOutputFormat;
  else if (settingId === 'dateFormat') element = suicaDateFormat;
  else if (settingId === 'encoding') element = suicaEncoding;
  
  if (!element) return;
  
  (suicaSettings as any)[settingId] = element.value;

  // データの再フィルタリング
  if (suicaTransactions.length > 0) {
    processAndFilterSuicaData();
    displaySuicaPreview();
  }
}

// ── Format Suica Date ──
function formatSuicaDate(dateString: string): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (suicaSettings.dateFormat) {
    case 'yyyy/mm/dd':
      return `${year}/${month}/${day}`;
    case 'dd/mm/yyyy':
      return `${day}/${month}/${year}`;
    case 'yyyy-mm-dd':
    default:
      return `${year}-${month}-${day}`;
  }
}

// ── Get Format Display Name ──
function getFormatDisplayName(): string {
  switch (suicaSettings.outputFormat) {
    case 'raw': return '編集なし';
    case 'freee': return 'freee用';
    case 'moneyforward': return 'MoneyForward用';
    default: return '';
  }
}

// ── Generate CSV by Format ──
function generateCsvByFormat(): string {
  switch (suicaSettings.outputFormat) {
    case 'raw': return generateRawCsvData();
    case 'freee': return generateFreeeCsvData();
    case 'moneyforward': return generateRawCsvData(); // 今後実装
    default: return generateRawCsvData();
  }
}

// ── Generate Raw CSV Data ──
function generateRawCsvData(): string {
  const delimiter = ',';
  const csvHeader = ['取引日', '取引金額', '取引内容', '残高'];
  const csvRows = [csvHeader.join(delimiter)];

  suicaFilteredTransactions.forEach((tx) => {
    csvRows.push([
      tx.date,
      tx.amount,
      tx.details,
      tx.balance || ''
    ].map((v) => `"${v}"`).join(delimiter));
  });

  return csvRows.join('\r\n');
}

// ── Generate freee CSV Data ──
function generateFreeeCsvData(): string {
  const delimiter = ',';
  const csvHeader = ['取引日', '取引金額', '取引内容'];
  const csvRows = [csvHeader.join(delimiter)];

  suicaFilteredTransactions.forEach((tx) => {
    const row = [
      formatSuicaDate(tx.date),
      tx.amount,
      tx.details
    ];

    const escapedRow = row.map((cell) => {
      const cellStr = String(cell);
      if (cellStr.includes(delimiter) || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    });

    csvRows.push(escapedRow.join(delimiter));
  });

  return csvRows.join('\n');
}

// ── Export Suica CSV ──
function exportSuicaCsv() {
  if (suicaFilteredTransactions.length === 0) {
    showSuicaStatus('エクスポートするデータがありません', 'error');
    return;
  }

  try {
    const formatName = getFormatDisplayName();
    showSuicaStatus(`${formatName}CSVファイルを生成中...`, 'info');

    const csvData = generateCsvByFormat();

    const blob = new Blob([csvData], {
      type: suicaSettings.encoding === 'shift-jis' ? 'text/csv;charset=shift-jis' : 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suica_history_${suicaSettings.outputFormat}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuicaStatus(`${formatName}CSVファイルをダウンロードしました（${suicaFilteredTransactions.length}件）`, 'success');
  } catch (err: any) {
    showSuicaStatus(`CSVエクスポート中にエラーが発生しました: ${err.message}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// SBI Bank Functions
// ══════════════════════════════════════════════════════════

// ── SBI Event Listeners ──
sbiFetchPage?.addEventListener('click', () => loadSbiBankData());
sbiFetchNotion?.addEventListener('click', () => loadNotionBankDataAndMatch());
sbiSelectAll?.addEventListener('change', () => toggleSelectAllSbi());
sbiAddToNotion?.addEventListener('click', () => addSelectedSbiToNotion());

// ── Initialize SBI Tab ──
function initSbiTab() {
  // Reset state
  sbiPageTransactions = [];
  sbiNotionTransactions = [];
  sbiNewTransactions = [];
  sbiExistingTransactions = [];
  sbiPeriodInfo = '';
  sbiSelectedTransactions.clear();

  // Reset UI
  if (sbiPageStatus) sbiPageStatus.textContent = '';
  if (sbiPeriod) {
    sbiPeriod.textContent = '';
    sbiPeriod.classList.remove('show');
  }
  if (sbiFetchNotion) sbiFetchNotion.disabled = true;
  if (sbiNotionStatus) sbiNotionStatus.textContent = '';
  if (sbiResultStep) sbiResultStep.style.display = 'none';
  if (sbiPreview) sbiPreview.textContent = '';
}

// ── Load SBI Bank Data from Page ──
async function loadSbiBankData() {
  if (!sbiFetchPage) return;

  sbiFetchPage.disabled = true;
  showSbiStatus(sbiPageStatus, '取得中...', 'loading');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const result = await sendMessageToTab<{
      success: boolean;
      data: BankTransaction[];
      period?: string;
      error?: string;
    }>(tab.id, { action: 'EXTRACT_BANK_DATA' });

    if (!result?.success) {
      throw new Error(result?.error || 'Failed to extract bank data');
    }

    sbiPageTransactions = result.data;
    sbiPeriodInfo = result.period || '';

    // Update UI
    showSbiStatus(sbiPageStatus, `${sbiPageTransactions.length}件の明細を取得しました`, 'success');

    if (sbiPeriod && sbiPeriodInfo) {
      sbiPeriod.textContent = `📅 期間: ${sbiPeriodInfo}`;
      sbiPeriod.classList.add('show');
    }

    // Enable Notion fetch button
    if (sbiFetchNotion) sbiFetchNotion.disabled = false;

    // Show preview
    if (sbiPreview) {
      sbiPreview.textContent = JSON.stringify(sbiPageTransactions.slice(0, 5), null, 2);
    }

    // Reset result step
    if (sbiResultStep) sbiResultStep.style.display = 'none';
  } catch (err: any) {
    showSbiStatus(sbiPageStatus, `エラー: ${err.message}`, 'error');
    if (sbiFetchNotion) sbiFetchNotion.disabled = true;
  } finally {
    sbiFetchPage.disabled = false;
  }
}

// ── Load Notion Bank Data and Match ──
async function loadNotionBankDataAndMatch() {
  if (!sbiFetchNotion || sbiPageTransactions.length === 0) return;

  sbiFetchNotion.disabled = true;
  showSbiStatus(sbiNotionStatus, 'Notionからデータを取得中...', 'loading');

  try {
    // Parse period from sbiPeriodInfo (e.g., "2026年1月")
    const periodMatch = sbiPeriodInfo.match(/(\d{4})年(\d{1,2})月/);
    if (!periodMatch) {
      throw new Error('期間情報を解析できませんでした');
    }

    const year = parseInt(periodMatch[1]);
    const month = parseInt(periodMatch[2]);

    // Calculate start and end dates for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

    // Fetch from Notion
    const result = await chrome.runtime.sendMessage({
      action: 'GET_NOTION_BANK_DATA',
      payload: { startDate, endDate },
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    sbiNotionTransactions = result.data || [];
    showSbiStatus(sbiNotionStatus, `Notionから${sbiNotionTransactions.length}件取得しました。照合中...`, 'success');

    // Match transactions
    matchBankTransactions();

    // Display results
    displaySbiMatchResults();
  } catch (err: any) {
    showSbiStatus(sbiNotionStatus, `エラー: ${err.message}`, 'error');
  } finally {
    sbiFetchNotion.disabled = false;
  }
}

// ── Match Bank Transactions ──
function matchBankTransactions() {
  sbiNewTransactions = [];
  sbiExistingTransactions = [];

  for (const pageTx of sbiPageTransactions) {
    // Check if this transaction exists in Notion
    // Match by date AND (withdrawal OR deposit amount)
    const exists = sbiNotionTransactions.some((notionTx) => {
      if (pageTx.date !== notionTx.date) return false;

      // Match withdrawal
      if (pageTx.withdrawal != null && notionTx.withdrawal != null) {
        if (pageTx.withdrawal === notionTx.withdrawal) return true;
      }

      // Match deposit
      if (pageTx.deposit != null && notionTx.deposit != null) {
        if (pageTx.deposit === notionTx.deposit) return true;
      }

      return false;
    });

    if (exists) {
      sbiExistingTransactions.push(pageTx);
    } else {
      sbiNewTransactions.push(pageTx);
    }
  }

  // Initialize selected transactions (all new transactions selected by default)
  sbiSelectedTransactions.clear();
  sbiNewTransactions.forEach((_, index) => {
    sbiSelectedTransactions.add(index);
  });
}

// ── Display SBI Match Results ──
function displaySbiMatchResults() {
  if (!sbiResultStep || !sbiNewCount || !sbiExistingCount || !sbiNewList) return;

  sbiResultStep.style.display = 'block';
  sbiNewCount.textContent = String(sbiNewTransactions.length);
  sbiExistingCount.textContent = String(sbiExistingTransactions.length);

  if (sbiNewTransactions.length === 0) {
    sbiNewList.innerHTML = '<div class="sbi-empty">新規の取引はありません</div>';
    if (sbiAddToNotion) sbiAddToNotion.disabled = true;
    if (sbiSelectAll) sbiSelectAll.checked = false;
    return;
  }

  // Render new transactions list
  sbiNewList.innerHTML = sbiNewTransactions.map((tx, index) => {
    const isChecked = sbiSelectedTransactions.has(index);
    const amountClass = tx.deposit ? 'deposit' : 'withdrawal';
    const amountStr = tx.deposit
      ? `+${tx.deposit.toLocaleString()}円`
      : `-${tx.withdrawal?.toLocaleString()}円`;

    return `
      <div class="sbi-transaction-item">
        <input type="checkbox" data-index="${index}" ${isChecked ? 'checked' : ''}>
        <div class="sbi-transaction-info">
          <div class="sbi-transaction-date">${tx.date}</div>
          <div class="sbi-transaction-desc">${tx.description}</div>
        </div>
        <div class="sbi-transaction-amount ${amountClass}">${amountStr}</div>
      </div>
    `;
  }).join('');

  // Attach checkbox listeners
  const checkboxes = sbiNewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const index = parseInt(cb.dataset.index || '0');
      if (cb.checked) {
        sbiSelectedTransactions.add(index);
      } else {
        sbiSelectedTransactions.delete(index);
      }
      updateSbiAddButton();
    });
  });

  updateSbiAddButton();
}

// ── Toggle Select All ──
function toggleSelectAllSbi() {
  if (!sbiSelectAll || !sbiNewList) return;

  const checkboxes = sbiNewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

  if (sbiSelectAll.checked) {
    // Select all
    sbiSelectedTransactions.clear();
    sbiNewTransactions.forEach((_, index) => {
      sbiSelectedTransactions.add(index);
    });
    checkboxes.forEach((cb) => (cb.checked = true));
  } else {
    // Deselect all
    sbiSelectedTransactions.clear();
    checkboxes.forEach((cb) => (cb.checked = false));
  }

  updateSbiAddButton();
}

// ── Update SBI Add Button ──
function updateSbiAddButton() {
  if (!sbiAddToNotion) return;
  const count = sbiSelectedTransactions.size;
  sbiAddToNotion.disabled = count === 0;
  sbiAddToNotion.textContent = `📤 選択した取引をNotionに追加 (${count}件)`;
}

// ── Add Selected SBI Transactions to Notion ──
async function addSelectedSbiToNotion() {
  if (!sbiAddToNotion || sbiSelectedTransactions.size === 0) return;

  const transactionsToAdd = Array.from(sbiSelectedTransactions).map(
    (index) => sbiNewTransactions[index]
  );

  sbiAddToNotion.disabled = true;
  sbiAddToNotion.textContent = '📤 追加中...';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'SAVE_BANK_TRANSACTIONS',
      payload: { transactions: transactionsToAdd },
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    showToast(`${result.count}件の取引をNotionに追加しました ✓`, 'success');

    // Update UI - remove added items from new list
    sbiNewTransactions = sbiNewTransactions.filter(
      (_, index) => !sbiSelectedTransactions.has(index)
    );
    sbiSelectedTransactions.clear();

    // Re-display results
    displaySbiMatchResults();
  } catch (err: any) {
    showToast(`エラー: ${err.message}`, 'error');
    sbiAddToNotion.disabled = false;
    updateSbiAddButton();
  }
}

// ── Show SBI Status ──
function showSbiStatus(element: HTMLElement | null, message: string, type: 'success' | 'error' | 'loading') {
  if (!element) return;
  element.textContent = message;
  element.className = `sbi-status ${type}`;
}

// ══════════════════════════════════════════════════════════
// Card Tab Functions
// ══════════════════════════════════════════════════════════

// ── Card Event Listeners ──
cardFetchCurrent?.addEventListener('click', () => fetchCurrentPageCardBilling());
cardClearAll?.addEventListener('click', () => clearAllCardBillings());
cardBatchCheck?.addEventListener('click', () => batchCheckCardDuplicates());
cardBatchAdd?.addEventListener('click', () => batchAddCardBillingsToNotion());

// ── Session Storage Key ──
const CARD_STOCK_KEY = 'cardBillingStock';

// ── Load Card Stock from Session Storage ──
async function loadCardStock(): Promise<CardBillingStock | null> {
  try {
    const result = await chrome.storage.session.get(CARD_STOCK_KEY);
    return result[CARD_STOCK_KEY] || null;
  } catch {
    return null;
  }
}

// ── Save Card Stock to Session Storage ──
async function saveCardStock(stock: CardBillingStock): Promise<void> {
  try {
    await chrome.storage.session.set({ [CARD_STOCK_KEY]: stock });
  } catch (err) {
    console.error('Failed to save card stock:', err);
  }
}

// ── Clear Card Stock from Session Storage ──
async function clearCardStock(): Promise<void> {
  try {
    await chrome.storage.session.remove(CARD_STOCK_KEY);
  } catch (err) {
    console.error('Failed to clear card stock:', err);
  }
}

// ── Generate Group ID ──
function generateGroupId(cardCompany: string, cardName: string): string {
  return `${cardCompany}-${cardName.replace(/\s+/g, '_')}`;
}

// ── Initialize Card Tab ──
async function initCardTab() {
  const cardCompany = getCardCompany();

  // カード会社情報の表示を非表示に
  if (cardCompanyInfo) {
    cardCompanyInfo.style.display = 'none';
  }

  // セッションストレージからデータをロード
  const stock = await loadCardStock();
  if (stock && stock.groups.length > 0) {
    cardBillingGroups = stock.groups;
  }

  // 選択状態を初期化
  cardSelectedBillings.clear();
  cardDuplicateResults.clear();
  cardHasCheckedDuplicates = false;

  // UI表示
  displayCardGroups();
  updateBatchSection();

  // カードサイトの場合は自動でデータを取得
  if (cardCompany) {
    await fetchCurrentPageCardBilling();
  }
}

// ── Get Card Company from Current Hostname ──
function getCardCompany(): 'amex' | 'smbc' | null {
  if (currentHostname.includes('americanexpress.com')) {
    return 'amex';
  }
  if (currentHostname.includes('smbc-card.com')) {
    return 'smbc';
  }
  return null;
}

// ── Fetch Current Page Card Billing ──
async function fetchCurrentPageCardBilling() {
  const cardCompany = getCardCompany();
  if (!cardCompany) {
    showCardStatus('このページはカード会社のページではありません', 'error');
    return;
  }

  if (cardFetchCurrent) cardFetchCurrent.disabled = true;
  showCardStatus('データを取得中...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const result = await sendMessageToTab<{ success: boolean; data: CardBilling[]; error?: string }>(tab.id, { action: 'GET_CARD_BILLING' });
    if (!result?.success) throw new Error(result?.error || 'Failed to get card billing');

    const newBillings = result.data;

    if (newBillings.length === 0) {
      showCardStatus('引き落とし情報が見つかりませんでした', 'info');
      return;
    }

    // カードごとにグループ化
    const groupMap = new Map<string, CardBilling[]>();
    for (const billing of newBillings) {
      const groupId = generateGroupId(billing.cardCompany, billing.cardName);
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      groupMap.get(groupId)!.push(billing);
    }

    // 既存のグループを更新または新規追加
    for (const [groupId, billings] of groupMap) {
      const existingIndex = cardBillingGroups.findIndex(g => g.id === groupId);
      const newGroup: CardBillingGroup = {
        id: groupId,
        cardCompany: billings[0].cardCompany,
        cardName: billings[0].cardName,
        billings: billings,
        fetchedAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        // 既存グループを更新
        cardBillingGroups[existingIndex] = newGroup;
      } else {
        // 新規グループを追加
        cardBillingGroups.push(newGroup);
      }
    }

    // セッションストレージに保存
    await saveCardStock({
      groups: cardBillingGroups,
      lastUpdated: new Date().toISOString(),
    });

    // 重複チェック結果をリセット
    cardDuplicateResults.clear();
    cardHasCheckedDuplicates = false;

    // UI更新
    displayCardGroups();
    updateBatchSection();
    showCardStatus(`${newBillings.length}件の引き落とし情報をストックしました`, 'success');
  } catch (err: any) {
    showCardStatus(`エラー: ${err.message}`, 'error');
  } finally {
    if (cardFetchCurrent) cardFetchCurrent.disabled = false;
  }
}

// ── Clear All Card Billings ──
async function clearAllCardBillings() {
  cardBillingGroups = [];
  cardSelectedBillings.clear();
  cardDuplicateResults.clear();
  cardHasCheckedDuplicates = false;

  await clearCardStock();

  displayCardGroups();
  updateBatchSection();
  showCardStatus('すべてのストックをクリアしました', 'info');
}

// ── Remove Card Group ──
async function removeCardGroup(groupId: string) {
  cardBillingGroups = cardBillingGroups.filter(g => g.id !== groupId);
  cardSelectedBillings.delete(groupId);
  cardDuplicateResults.delete(groupId);

  await saveCardStock({
    groups: cardBillingGroups,
    lastUpdated: new Date().toISOString(),
  });

  displayCardGroups();
  updateBatchSection();
}

// ── Display Card Groups ──
function displayCardGroups() {
  if (!cardGroupsContainer) return;

  if (cardBillingGroups.length === 0) {
    cardGroupsContainer.innerHTML = `
      <div class="card-empty-stock">
        <p>📭 ストックされたデータはありません</p>
        <p class="card-empty-hint">カード会社のページを開くと自動でデータがストックされます</p>
      </div>
    `;
    return;
  }

  cardGroupsContainer.innerHTML = cardBillingGroups.map((group) => {
    const fetchedDate = new Date(group.fetchedAt).toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const selectedSet = cardSelectedBillings.get(group.id) || new Set();
    const duplicateResults = cardDuplicateResults.get(group.id) || [];
    const allSelected = group.billings.length > 0 && selectedSet.size === group.billings.length;

    return `
      <div class="card-group" data-group-id="${group.id}">
        <div class="card-group-header">
          <div class="card-group-info">
            <input type="checkbox" class="card-group-checkbox" data-group-id="${group.id}" ${allSelected ? 'checked' : ''}>
            <span class="card-group-name">${group.cardName}</span>
          </div>
          <div class="card-group-actions">
            <span class="card-group-fetched">取得: ${fetchedDate}</span>
            <button class="card-group-remove" data-group-id="${group.id}" title="削除">✕</button>
          </div>
        </div>
        <div class="card-group-body">
          <div class="card-group-items">
            ${group.billings.map((billing, index) => {
              const isSelected = selectedSet.has(index);
              const dupResult = duplicateResults.find(r => 
                r.billing.paymentDate === billing.paymentDate && 
                r.billing.amount === billing.amount
              );
              const isDuplicate = dupResult?.isDuplicate ?? false;
              const statusClass = billing.isConfirmed ? 'confirmed' : 'pending';
              const statusText = billing.isConfirmed ? '確定' : '未確定';
              const itemClass = isDuplicate ? 'duplicate' : (cardHasCheckedDuplicates ? 'new-item' : '');

              return `
                <div class="card-group-item ${itemClass}">
                  <input type="checkbox" 
                    data-group-id="${group.id}" 
                    data-billing-index="${index}"
                    ${isSelected ? 'checked' : ''}
                    ${isDuplicate ? 'disabled' : ''}>
                  <div class="card-group-item-content">
                    <div class="card-group-item-info">
                      <span class="card-group-item-date">
                        ${billing.paymentDate} 引き落とし
                        <span class="card-group-item-status ${statusClass}">${statusText}</span>
                        ${isDuplicate ? '<span class="duplicate-badge">重複</span>' : ''}
                        ${cardHasCheckedDuplicates && !isDuplicate ? '<span class="new-badge">新規</span>' : ''}
                      </span>
                    </div>
                    <div class="card-group-item-amount">
                      ${billing.amount.toLocaleString()}<span class="card-group-item-currency">円</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // イベントリスナーをアタッチ
  attachCardGroupListeners();
}

// ── Attach Card Group Listeners ──
function attachCardGroupListeners() {
  if (!cardGroupsContainer) return;

  // グループ削除ボタン
  const removeButtons = cardGroupsContainer.querySelectorAll<HTMLButtonElement>('.card-group-remove');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupId;
      if (groupId) removeCardGroup(groupId);
    });
  });

  // グループ全選択チェックボックス
  const groupCheckboxes = cardGroupsContainer.querySelectorAll<HTMLInputElement>('.card-group-checkbox');
  groupCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const groupId = cb.dataset.groupId;
      if (!groupId) return;

      const group = cardBillingGroups.find(g => g.id === groupId);
      if (!group) return;

      const duplicateResults = cardDuplicateResults.get(groupId) || [];

      if (cb.checked) {
        // 重複でないものだけ選択
        const selectedSet = new Set<number>();
        group.billings.forEach((billing, index) => {
          const isDuplicate = duplicateResults.some(r => 
            r.billing.paymentDate === billing.paymentDate && 
            r.billing.amount === billing.amount && 
            r.isDuplicate
          );
          if (!isDuplicate) {
            selectedSet.add(index);
          }
        });
        cardSelectedBillings.set(groupId, selectedSet);
      } else {
        cardSelectedBillings.delete(groupId);
      }

      displayCardGroups();
      updateBatchSection();
    });
  });

  // 個別チェックボックス
  const itemCheckboxes = cardGroupsContainer.querySelectorAll<HTMLInputElement>('.card-group-item input[type="checkbox"]');
  itemCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const groupId = cb.dataset.groupId;
      const billingIndex = parseInt(cb.dataset.billingIndex || '0');
      if (!groupId) return;

      let selectedSet = cardSelectedBillings.get(groupId);
      if (!selectedSet) {
        selectedSet = new Set();
        cardSelectedBillings.set(groupId, selectedSet);
      }

      if (cb.checked) {
        selectedSet.add(billingIndex);
      } else {
        selectedSet.delete(billingIndex);
      }

      updateBatchSection();
      // グループヘッダーのチェックボックスも更新
      const group = cardBillingGroups.find(g => g.id === groupId);
      if (group) {
        const groupCb = cardGroupsContainer.querySelector<HTMLInputElement>(`.card-group-checkbox[data-group-id="${groupId}"]`);
        if (groupCb) {
          const duplicateResults = cardDuplicateResults.get(groupId) || [];
          const selectableCount = group.billings.filter((billing, idx) => {
            const isDuplicate = duplicateResults.some(r => 
              r.billing.paymentDate === billing.paymentDate && 
              r.billing.amount === billing.amount && 
              r.isDuplicate
            );
            return !isDuplicate;
          }).length;
          groupCb.checked = selectedSet.size === selectableCount && selectableCount > 0;
        }
      }
    });
  });
}

// ── Update Batch Section ──
function updateBatchSection() {
  // 選択中の件数を計算
  let totalSelected = 0;
  for (const selectedSet of cardSelectedBillings.values()) {
    totalSelected += selectedSet.size;
  }

  // 一括操作セクションの表示/非表示
  if (cardBatchSection) {
    cardBatchSection.style.display = cardBillingGroups.length > 0 ? 'block' : 'none';
  }

  // 選択件数を更新
  if (cardBatchCount) {
    cardBatchCount.textContent = `${totalSelected}件選択中`;
  }

  // ボタンの状態を更新
  if (cardBatchCheck) {
    const totalBillings = cardBillingGroups.reduce((sum, g) => sum + g.billings.length, 0);
    cardBatchCheck.disabled = totalBillings === 0;
  }

  if (cardBatchAdd) {
    cardBatchAdd.disabled = totalSelected === 0;
    cardBatchAdd.textContent = `📤 選択をNotionに追加 (${totalSelected}件)`;
  }

  // 重複チェック結果の表示
  if (cardBatchResult && cardHasCheckedDuplicates) {
    let totalNew = 0;
    let totalDuplicate = 0;

    for (const results of cardDuplicateResults.values()) {
      for (const r of results) {
        if (r.isDuplicate) {
          totalDuplicate++;
        } else {
          totalNew++;
        }
      }
    }

    cardBatchResult.style.display = 'block';
    if (cardBatchNewCount) cardBatchNewCount.textContent = String(totalNew);
    if (cardBatchDuplicateCount) cardBatchDuplicateCount.textContent = String(totalDuplicate);
  } else if (cardBatchResult) {
    cardBatchResult.style.display = 'none';
  }
}

// ── Show Card Status ──
function showCardStatus(message: string, type: 'success' | 'error' | 'info') {
  if (!cardStatus) return;
  cardStatus.textContent = message;
  cardStatus.className = `card-status ${type}`;
}

// ── Batch Check Card Duplicates ──
async function batchCheckCardDuplicates() {
  if (cardBillingGroups.length === 0) {
    showToast('チェックするデータがありません', 'error');
    return;
  }

  if (cardBatchCheck) cardBatchCheck.disabled = true;
  showCardStatus('Notionと照合中...', 'info');

  try {
    // 全グループのbillingを集める
    const allBillings: CardBilling[] = [];
    for (const group of cardBillingGroups) {
      allBillings.push(...group.billings);
    }

    const result = await chrome.runtime.sendMessage({
      action: 'CHECK_CARD_BILLING_DUPLICATES',
      payload: { billings: allBillings },
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    // 結果をグループごとに振り分け
    cardDuplicateResults.clear();
    const duplicateBillings: CardBilling[] = result.duplicates?.map((d: { billing: CardBilling }) => d.billing) || [];
    const newBillings: CardBilling[] = result.newBillings || [];

    for (const group of cardBillingGroups) {
      const groupResults: { billing: CardBilling; isDuplicate: boolean }[] = [];
      
      for (const billing of group.billings) {
        const isDuplicate = duplicateBillings.some(d => 
          d.cardCompany === billing.cardCompany &&
          d.cardName === billing.cardName &&
          d.paymentDate === billing.paymentDate &&
          d.amount === billing.amount
        );
        groupResults.push({ billing, isDuplicate });
      }
      
      cardDuplicateResults.set(group.id, groupResults);
    }

    cardHasCheckedDuplicates = true;

    // 選択状態を更新（重複は選択解除）
    for (const [groupId, results] of cardDuplicateResults) {
      const selectedSet = cardSelectedBillings.get(groupId) || new Set<number>();
      const group = cardBillingGroups.find(g => g.id === groupId);
      if (!group) continue;

      // 新規のものを全て選択
      const newSelectedSet = new Set<number>();
      results.forEach((r, index) => {
        if (!r.isDuplicate) {
          newSelectedSet.add(index);
        }
      });
      cardSelectedBillings.set(groupId, newSelectedSet);
    }

    // UI更新
    displayCardGroups();
    updateBatchSection();

    const dupCount = duplicateBillings.length;
    const newCount = newBillings.length;
    if (dupCount > 0) {
      showCardStatus(`${dupCount}件の重複、${newCount}件が新規です`, 'info');
    } else {
      showCardStatus(`${newCount}件すべて新規です`, 'success');
    }
  } catch (err: any) {
    showCardStatus(`エラー: ${err.message}`, 'error');
  } finally {
    if (cardBatchCheck) cardBatchCheck.disabled = false;
  }
}

// ── Batch Add Card Billings to Notion ──
async function batchAddCardBillingsToNotion() {
  // 選択されたbillingを集める
  const billingsToAdd: CardBilling[] = [];
  
  for (const [groupId, selectedSet] of cardSelectedBillings) {
    const group = cardBillingGroups.find(g => g.id === groupId);
    if (!group) continue;

    for (const index of selectedSet) {
      if (group.billings[index]) {
        billingsToAdd.push(group.billings[index]);
      }
    }
  }

  if (billingsToAdd.length === 0) {
    showToast('追加する項目を選択してください', 'error');
    return;
  }

  if (cardBatchAdd) {
    cardBatchAdd.disabled = true;
    cardBatchAdd.textContent = '📤 追加中...';
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'SAVE_CARD_BILLING',
      payload: { billings: billingsToAdd },
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    showToast(`${result.count}件の引き落としをNotionに追加しました ✓`, 'success');

    // 追加したbillingをグループから削除
    for (const [groupId, selectedSet] of cardSelectedBillings) {
      const groupIndex = cardBillingGroups.findIndex(g => g.id === groupId);
      if (groupIndex < 0) continue;

      const group = cardBillingGroups[groupIndex];
      const newBillings = group.billings.filter((_, index) => !selectedSet.has(index));

      if (newBillings.length === 0) {
        // グループが空になったら削除
        cardBillingGroups.splice(groupIndex, 1);
        cardDuplicateResults.delete(groupId);
      } else {
        group.billings = newBillings;
        // 重複チェック結果も更新
        const dupResults = cardDuplicateResults.get(groupId);
        if (dupResults) {
          const newDupResults = dupResults.filter((_, index) => !selectedSet.has(index));
          cardDuplicateResults.set(groupId, newDupResults);
        }
      }
    }

    // 選択状態をクリア
    cardSelectedBillings.clear();

    // セッションストレージに保存
    await saveCardStock({
      groups: cardBillingGroups,
      lastUpdated: new Date().toISOString(),
    });

    // UI更新
    displayCardGroups();
    updateBatchSection();
    showCardStatus(`${result.count}件をNotionに追加しました`, 'success');
  } catch (err: any) {
    showToast(`エラー: ${err.message}`, 'error');
  } finally {
    updateBatchSection();
  }
}

// ══════════════════════════════════════════════════════════
// ANA Calendar Functions (Notion予定表示)
// ══════════════════════════════════════════════════════════

let anaViewYear = new Date().getFullYear();
let anaViewMonth = new Date().getMonth();
let anaInitialized = false;
let anaEvents: CalendarEvent[] = [];
let anaSelectedDateKey: string | null = null;

function fmtDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fmtDateDisplay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${y}/${m}/${d} (${wd})`;
}

function getEventsForDate(key: string): CalendarEvent[] {
  return anaEvents.filter((ev) => {
    if (ev.endDate) {
      return key >= ev.date && key <= ev.endDate;
    }
    return ev.date === key;
  });
}

async function initAnaTab() {
  if (!anaInitialized) {
    anaInitialized = true;

    document.getElementById('ana-prev')?.addEventListener('click', () => {
      anaViewMonth--;
      if (anaViewMonth < 0) {
        anaViewMonth = 11;
        anaViewYear--;
      }
      anaSelectedDateKey = null;
      renderAnaCalendar();
      loadAnaEvents();
    });

    document.getElementById('ana-next')?.addEventListener('click', () => {
      anaViewMonth++;
      if (anaViewMonth > 11) {
        anaViewMonth = 0;
        anaViewYear++;
      }
      anaSelectedDateKey = null;
      renderAnaCalendar();
      loadAnaEvents();
    });

    document.getElementById('ana-reload')?.addEventListener('click', () => loadAnaEvents());
  }

  renderAnaCalendar();
  await loadAnaEvents();
}

function showAnaStatus(message: string, type: 'info' | 'error' | 'success' | '' = '') {
  const el = document.getElementById('ana-status');
  if (!el) return;
  el.textContent = message;
  el.className = `ana-status ${type}`.trim();
}

async function loadAnaEvents() {
  const startDate = fmtDateKey(anaViewYear, anaViewMonth, 1);
  const lastDay = new Date(anaViewYear, anaViewMonth + 1, 0).getDate();
  const endDate = fmtDateKey(anaViewYear, anaViewMonth, lastDay);

  showAnaStatus('予定を取得中...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'GET_CALENDAR_EVENTS',
      payload: { startDate, endDate },
    });

    if (result?.error) throw new Error(result.error);

    anaEvents = result.data || [];
    showAnaStatus(`${anaEvents.length}件の予定`, 'success');
    renderAnaCalendar();
    renderAnaDayDetail();
  } catch (err: any) {
    anaEvents = [];
    const msg = err.message || '取得に失敗しました';
    if (msg.includes('not configured')) {
      showAnaStatus('Calendar Database を設定画面で設定してください', 'error');
    } else {
      showAnaStatus(`エラー: ${msg}`, 'error');
    }
    renderAnaCalendar();
  }
}

function renderAnaCalendar() {
  const grid = document.getElementById('ana-grid');
  const label = document.getElementById('ana-month-label');
  if (!grid || !label) return;

  label.textContent = `${anaViewYear}年 ${anaViewMonth + 1}月`;

  const firstDay = new Date(anaViewYear, anaViewMonth, 1);
  const lastDay = new Date(anaViewYear, anaViewMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay();

  const today = new Date();
  const todayKey = fmtDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  let html = '';
  for (let i = 0; i < startWeekday; i++) {
    html += '<span class="ana-day empty"></span>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = fmtDateKey(anaViewYear, anaViewMonth, d);
    const wd = new Date(anaViewYear, anaViewMonth, d).getDay();
    const classes = ['ana-day'];
    if (wd === 0) classes.push('sun');
    if (wd === 6) classes.push('sat');
    if (key === todayKey) classes.push('today');
    if (key === anaSelectedDateKey) classes.push('selected');

    const events = getEventsForDate(key);
    const hasEvent = events.length > 0;
    if (hasEvent) classes.push('has-event');

    const dotsHtml = hasEvent
      ? `<span class="ana-day-dots">${events.slice(0, 3).map(() => '<span class="ana-dot"></span>').join('')}</span>`
      : '';

    html += `<button class="${classes.join(' ')}" data-key="${key}"><span class="ana-day-num">${d}</span>${dotsHtml}</button>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll<HTMLButtonElement>('.ana-day:not(.empty)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (!key) return;
      anaSelectedDateKey = anaSelectedDateKey === key ? null : key;
      renderAnaCalendar();
      renderAnaDayDetail();
    });
  });
}

function renderAnaDayDetail() {
  const el = document.getElementById('ana-day-detail');
  if (!el) return;

  if (!anaSelectedDateKey) {
    el.innerHTML = '';
    return;
  }

  const events = getEventsForDate(anaSelectedDateKey);
  const heading = `<div class="ana-detail-date">${fmtDateDisplay(anaSelectedDateKey)}</div>`;

  if (events.length === 0) {
    el.innerHTML = `${heading}<div class="ana-detail-empty">予定なし</div>`;
    return;
  }

  const list = events
    .map((ev) => {
      const range = ev.endDate && ev.endDate !== ev.date ? ` <span class="ana-event-range">(${ev.date} 〜 ${ev.endDate})</span>` : '';
      const escaped = ev.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<li class="ana-event-item">${escaped}${range}</li>`;
    })
    .join('');

  el.innerHTML = `${heading}<ul class="ana-event-list">${list}</ul>`;
}

// ── Start ──
init();
