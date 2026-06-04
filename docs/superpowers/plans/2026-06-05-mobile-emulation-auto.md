# スマホ表示 自動切替機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tokyo-calendar-date.jp` を開いたとき、Chrome拡張が自動でモバイルUA・JS判定・ウィンドウ縦横比をスマホ相当に切り替える。

**Architecture:** 静的declarativeNetRequestルールで通信UAをiOS Safariに上書き、MAIN world注入スクリプトで`navigator.*`を上書き、service-workerのタブ監視リスナーで対象ドメインのウィンドウをスマホ縦横比にリサイズ／離脱時に復元する。sidepanel UIは関与しない。

**Tech Stack:** TypeScript / Webpack / Chrome Extension Manifest V3 (declarativeNetRequest, content_scripts world:MAIN, chrome.windows/tabs API)

**検証方針:** 本プロジェクトはテストフレームワーク未導入（CLAUDE.md）。各タスクは `npm run build` ＋ `chrome://extensions/` リロード後の手動検証で完了確認する。

**共通定数（全ファイルで一致させること）:**
- 対象ホスト名: `tokyo-calendar-date.jp`
- モバイルUA文字列: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`

---

## ファイル構成

| 操作 | パス | 責務 |
|---|---|---|
| Create | `rules/mobile-ua-rules.json` | DNR静的ルール（UA上書き） |
| Create | `src/content/mobile-emulation.ts` | MAIN worldで`navigator.*`を上書き |
| Create | `src/background/mobile-window.ts` | 対象タブ検知・ウィンドウリサイズ／復元 |
| Modify | `manifest.json` | 権限・DNRルール登録・content_scripts追加 |
| Modify | `webpack.config.js` | 新エントリ・rules JSONコピー |
| Modify | `src/background/service-worker.ts` | リスナー登録呼び出し |

---

## Task 1: DNR静的ルールでUA上書き

**Files:**
- Create: `rules/mobile-ua-rules.json`
- Modify: `manifest.json`
- Modify: `webpack.config.js:10-15` (entry), `webpack.config.js:51-56` (CopyWebpackPlugin)

- [ ] **Step 1: DNRルールJSONを作成**

Create `rules/mobile-ua-rules.json`:

```json
[
  {
    "id": 1,
    "priority": 1,
    "action": {
      "type": "modifyHeaders",
      "requestHeaders": [
        {
          "header": "User-Agent",
          "operation": "set",
          "value": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        }
      ]
    },
    "condition": {
      "requestDomains": ["tokyo-calendar-date.jp"],
      "resourceTypes": [
        "main_frame", "sub_frame", "script", "xmlhttprequest",
        "stylesheet", "image", "font", "media", "ping", "websocket", "other"
      ]
    }
  }
]
```

- [ ] **Step 2: manifest.json に権限・ホスト・ルール登録を追加**

`permissions` 配列（manifest.json:6-12）に `"declarativeNetRequest"` を追加:

```json
  "permissions": [
    "sidePanel",
    "activeTab",
    "storage",
    "tabs",
    "scripting",
    "declarativeNetRequest"
  ],
```

`host_permissions` 配列（manifest.json:13-23）末尾に対象サイトを追加（`"https://twitter.com/*"` の後）:

```json
    "https://twitter.com/*",
    "https://tokyo-calendar-date.jp/*"
```

`"background"` ブロックの直前（manifest.json:24 の前）に DNR ルール登録を追加:

```json
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "mobile-ua",
        "enabled": true,
        "path": "mobile-ua-rules.json"
      }
    ]
  },
```

- [ ] **Step 3: webpack の CopyWebpackPlugin に rules JSON を追加**

`webpack.config.js` の `CopyWebpackPlugin` patterns（webpack.config.js:52-55）に1行追加:

```js
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'icons', to: 'icons' },
          { from: 'rules/mobile-ua-rules.json', to: 'mobile-ua-rules.json' },
        ],
      }),
```

- [ ] **Step 4: ビルドして dist に出力されることを確認**

Run: `npm run build`
Expected: エラーなく完了し、`dist/mobile-ua-rules.json` と `dist/manifest.json` が生成される。`dist/manifest.json` に `declarative_net_request` が含まれること。

- [ ] **Step 5: Chrome実機でUA上書きを確認**

手順:
1. `chrome://extensions/` で Sidescribe をリロード（権限変更の承認が出たら許可）
2. `https://tokyo-calendar-date.jp/` を開く
3. DevTools > Network で main_frame リクエストの Request Headers の `User-Agent` が iOS Safari の文字列になっていること

Expected: User-Agent が `Mozilla/5.0 (iPhone; ...) ... Mobile/15E148 Safari/604.1` になっている。

- [ ] **Step 6: Commit**

```bash
git add rules/mobile-ua-rules.json manifest.json webpack.config.js
git commit -m "✨ Add DNR static rule to override UA on tokyo-calendar-date.jp"
```

---

## Task 2: MAIN world注入でnavigator.*を上書き

**Files:**
- Create: `src/content/mobile-emulation.ts`
- Modify: `webpack.config.js:10-15` (entry)
- Modify: `manifest.json` (content_scripts)

- [ ] **Step 1: 注入スクリプトを作成**

Create `src/content/mobile-emulation.ts`:

```ts
// MAIN world / document_start で navigator.* をモバイル値へ上書きし、
// ページ内JSのスマホ判定を成立させる。
// 注意: MOBILE_UA は rules/mobile-ua-rules.json の値と一致させること（手動同期）。

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function defineNavigatorProp(prop: string, value: unknown): void {
  try {
    Object.defineProperty(navigator, prop, {
      get: () => value,
      configurable: true,
    });
  } catch (e) {
    console.log('[Sidescribe] navigator override failed:', prop, e);
  }
}

defineNavigatorProp('userAgent', MOBILE_UA);
defineNavigatorProp('platform', 'iPhone');
defineNavigatorProp('maxTouchPoints', 5);
defineNavigatorProp('vendor', 'Apple Computer, Inc.');
defineNavigatorProp('userAgentData', undefined);

console.log('[Sidescribe] Mobile navigator override applied');
```

- [ ] **Step 2: webpack の entry に追加**

`webpack.config.js` の `entry`（webpack.config.js:10-15）に1行追加:

```js
    entry: {
      'service-worker': './src/background/service-worker.ts',
      'sidepanel': './src/sidepanel/sidepanel.ts',
      'options': './src/options/options.ts',
      'content': './src/content/content.ts',
      'mobile-emulation': './src/content/mobile-emulation.ts',
    },
```

- [ ] **Step 3: manifest.json の content_scripts に MAIN world エントリを追加**

`content_scripts` 配列（manifest.json:30-46）の既存オブジェクトの後ろに追加:

```json
  "content_scripts": [
    {
      "matches": [
        "https://www.netbk.co.jp/*",
        "https://*.gabaonline.jp/*",
        "https://my.gaba.jp/*",
        "https://*.jreast.co.jp/*",
        "https://www.mobilesuica.com/*",
        "https://global.americanexpress.com/*",
        "https://*.americanexpress.com/*",
        "https://www.smbc-card.com/*",
        "https://x.com/*",
        "https://twitter.com/*"
      ],
      "js": ["content.js"]
    },
    {
      "matches": ["https://tokyo-calendar-date.jp/*"],
      "js": ["mobile-emulation.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
```

- [ ] **Step 4: ビルドして bundle 出力を確認**

Run: `npm run build`
Expected: エラーなく完了し、`dist/mobile-emulation.js` が生成される。`dist/manifest.json` の content_scripts に `world: "MAIN"` エントリが含まれること。

- [ ] **Step 5: Chrome実機でnavigator上書きを確認**

手順:
1. `chrome://extensions/` で Sidescribe をリロード
2. `https://tokyo-calendar-date.jp/` を開く
3. DevTools > Console で以下を実行:
   - `navigator.userAgent` → iOS Safari の文字列
   - `navigator.maxTouchPoints` → `5`
   - `navigator.platform` → `iPhone`

Expected: いずれもモバイル値を返す。Console に `[Sidescribe] Mobile navigator override applied` のログが出ている。

- [ ] **Step 6: Commit**

```bash
git add src/content/mobile-emulation.ts webpack.config.js manifest.json
git commit -m "✨ Inject MAIN-world script to override navigator on target site"
```

---

## Task 3: ウィンドウをスマホ縦横比にリサイズ／復元

**Files:**
- Create: `src/background/mobile-window.ts`
- Modify: `src/background/service-worker.ts:1-8`

- [ ] **Step 1: ウィンドウ管理モジュールを作成**

Create `src/background/mobile-window.ts`:

```ts
// 対象ドメインのタブを開いたらウィンドウをスマホ縦横比にリサイズし、
// 離脱時に元のサイズへ復元する。

const TARGET_HOSTNAME = 'tokyo-calendar-date.jp';
const TARGET_WIDTH = 430;   // ウィンドウ全体の幅（視覚テスト後に調整）
const TARGET_HEIGHT = 860;  // ウィンドウ全体の高さ（視覚テスト後に調整）
const STORAGE_KEY_PREFIX = 'mobileWindowOriginalBounds:';

interface WindowBounds {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function isMobileTargetUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === TARGET_HOSTNAME;
  } catch {
    return false;
  }
}

async function getStoredBounds(windowId: number): Promise<WindowBounds | null> {
  const key = STORAGE_KEY_PREFIX + windowId;
  const result = await chrome.storage.session.get(key);
  return (result[key] as WindowBounds) ?? null;
}

async function storeBounds(windowId: number, bounds: WindowBounds): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY_PREFIX + windowId]: bounds });
}

async function clearStoredBounds(windowId: number): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEY_PREFIX + windowId);
}

async function resizeToMobile(windowId: number): Promise<void> {
  try {
    // すでに適用済み（元サイズ保存済み）なら何もしない
    const existing = await getStoredBounds(windowId);
    if (existing) return;

    const win = await chrome.windows.get(windowId);
    if (win.width == null || win.height == null || win.left == null || win.top == null) {
      return;
    }

    await storeBounds(windowId, {
      width: win.width,
      height: win.height,
      left: win.left,
      top: win.top,
    });

    await chrome.windows.update(windowId, {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
    });
    console.log('[Sidescribe] Resized window to mobile:', windowId);
  } catch (e) {
    console.log('[Sidescribe] resizeToMobile failed:', e);
  }
}

async function restoreWindow(windowId: number): Promise<void> {
  try {
    const bounds = await getStoredBounds(windowId);
    if (!bounds) return;
    await chrome.windows.update(windowId, {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
    });
    await clearStoredBounds(windowId);
    console.log('[Sidescribe] Restored window size:', windowId);
  } catch (e) {
    console.log('[Sidescribe] restoreWindow failed:', e);
  }
}

// 対象ウィンドウ内に対象タブが他に残っていなければ復元する
async function maybeRestoreWindow(windowId: number): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const stillHasTarget = tabs.some((t) => isMobileTargetUrl(t.url));
    if (!stillHasTarget) {
      await restoreWindow(windowId);
    }
  } catch (e) {
    console.log('[Sidescribe] maybeRestoreWindow failed:', e);
  }
}

export function registerMobileWindowListeners(): void {
  // タブのURL更新・読込状態を監視
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.windowId == null) return;
    if (isMobileTargetUrl(tab.url)) {
      resizeToMobile(tab.windowId);
    } else if (changeInfo.url) {
      // 対象タブが対象外URLへ遷移した
      maybeRestoreWindow(tab.windowId);
    }
  });

  // タブ切替を監視
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isMobileTargetUrl(tab.url)) {
        resizeToMobile(windowId);
      } else {
        maybeRestoreWindow(windowId);
      }
    } catch (e) {
      console.log('[Sidescribe] onActivated handler failed:', e);
    }
  });

  // タブが閉じられたとき（ウィンドウごと閉じる場合は除く）
  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
      maybeRestoreWindow(removeInfo.windowId);
    }
  });

  // ウィンドウが閉じられたら保存をクリーンアップ
  chrome.windows.onRemoved.addListener((windowId) => {
    clearStoredBounds(windowId);
  });
}
```

- [ ] **Step 2: service-worker でリスナーを登録**

`src/background/service-worker.ts` の冒頭（import群の後、`setPanelBehavior` の前後）に追加。

import を追加（service-worker.ts:1-3 の import群に続けて）:

```ts
import { Message, PageInfo, SuicaTransaction, PageMemo, BankTransaction, CardBilling } from '../types';
import { getSettings } from '../utils/storage';
import { notion } from '../modules/notion';
import { registerMobileWindowListeners } from './mobile-window';
```

`setPanelBehavior` 呼び出し（service-worker.ts:5-8）の直後にリスナー登録を追加:

```ts
// ── Side Panel をアイコンクリックで開く ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ── スマホ表示 自動切替（対象ドメインのウィンドウリサイズ）──
registerMobileWindowListeners();
```

- [ ] **Step 3: ビルドして型エラーが無いことを確認**

Run: `npm run build`
Expected: TypeScriptエラーなく完了。`dist/service-worker.js` にリサイズ処理が含まれる。

- [ ] **Step 4: Chrome実機でリサイズ／復元を確認**

手順:
1. `chrome://extensions/` で Sidescribe をリロード
2. 通常サイズのウィンドウで新規タブを開き `https://tokyo-calendar-date.jp/` にアクセス
   → ウィンドウがスマホ縦横比（約430×860）にリサイズされること
3. 同タブで別サイト（例: `https://example.com/`）へ遷移
   → ウィンドウが元のサイズに復元されること
4. 対象外サイトのみのウィンドウではリサイズが起きないこと

Expected: 対象サイトでリサイズ、離脱で復元。Service Workerのコンソール（拡張詳細 > Service Worker）に `Resized window to mobile` / `Restored window size` ログ。

- [ ] **Step 5: Commit**

```bash
git add src/background/mobile-window.ts src/background/service-worker.ts
git commit -m "✨ Auto-resize window to phone aspect on target site"
```

---

## Task 4: 統合検証とウィンドウサイズ微調整

**Files:**
- Modify: `src/background/mobile-window.ts:5-6`（必要に応じて定数調整）

- [ ] **Step 1: エンドツーエンドで全機能を確認**

`chrome://extensions/` でリロード後、`https://tokyo-calendar-date.jp/` を開き、以下すべてを確認:
- [ ] Network: main_frame の User-Agent が iOS Safari
- [ ] Console: `navigator.userAgent` / `maxTouchPoints` がモバイル値
- [ ] ページがモバイル版レイアウトで表示される
- [ ] ウィンドウがスマホ縦横比にリサイズされる
- [ ] 離脱で元サイズに復元される
- [ ] 対象外サイトでは一切影響が無い（UA・サイズとも通常）

- [ ] **Step 2: ウィンドウサイズ定数を実機の見た目に合わせて調整**

サイドパネルを開いた状態でcontent領域がスマホらしく見えるか確認し、必要なら `src/background/mobile-window.ts` の `TARGET_WIDTH` / `TARGET_HEIGHT` を調整する。調整した場合は `npm run build` → リロード → 再確認。

- [ ] **Step 3: 調整をコミット（変更があれば）**

```bash
git add src/background/mobile-window.ts
git commit -m "🔧 Tune mobile window dimensions to fit side panel"
```

---

## Self-Review メモ

- **スペック網羅**: UA上書き(Task1) / JS判定対応(Task2) / ウィンドウリサイズ・復元(Task3) / manifest・webpack変更(Task1-2) / 統合検証(Task4) — スペック全項目をカバー。
- **型整合**: `isMobileTargetUrl` / `registerMobileWindowListeners` の名称・シグネチャは Task3 定義と service-worker 呼び出しで一致。
- **UA二重管理**: スペック合意通り、TSの `MOBILE_UA` と JSON値を一致させる旨をコード/プラン両方に明記。
