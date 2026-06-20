# スマホ表示 自動切替機能 設計書

作成日: 2026-06-05

## 概要

特定のWebページにアクセスしたとき、Chrome拡張（Sidescribe）が自動的に「スマートフォン表示」へ切り替える機能を追加する。現状ユーザーは F12（DevToolsデバイスモード）で手動切替しているが、対象サイトでは自動化したい。

初回対象サイト: `https://tokyo-calendar-date.jp/`

## 目的とスコープ

- **目的**: 対象ドメインを開いたら、サーバーにもページ内JSにも「スマホである」と認識させ、かつウィンドウをスマホ縦横比に近づける。
- **スコープ（今回やること）**:
  - URLマッチによる**自動**切替（手動トグルは作らない）
  - 対象URLは**コードにハードコード**
  - User-Agent をモバイル（iOS Safari）に上書き
  - ページ内JS判定への対応（`navigator.*` 上書き）
  - 対象ドメインを開いたらウィンドウをスマホ縦横比にリサイズ、離れたら復元
- **やらないこと（YAGNI）**:
  - メイン画面の手動トグルボタン
  - オプション画面でのURLリスト編集
  - DevTools完全再現（chrome.debugger によるタッチ/DPR エミュレーション）※将来の拡張余地として記録

## 既知の制約（合意済み）

1. **画面幅の物理制約**: サイドパネル（Sidescribe）を開いた状態では、ウィンドウ全体を横幅390pxのスマホ型にはできない（サイドパネルが幅を占有するため）。そのため「content領域がスマホ縦横比に近づくよう、ウィンドウサイズを調整する」方針とする。
2. **UA上書きの効果範囲**: DNRが上書きするのは通信ヘッダのUAのみ。ページ内JSの `navigator.userAgent` 等は別途上書きが必要（本設計に含む）。
3. **chrome.debugger は使わない**: 黄色い警告バーを避けるため。よって画面サイズの厳密なデバイスエミュレーション（DPR・タッチ）は行わない。

## アーキテクチャ

既存の3コンテキスト構造に乗せる。今回は sidepanel UI を介さず、service-worker と新規スクリプトで完結する。

```
[静的DNRルール]  ──→  tokyo-calendar-date.jp への全リクエストの User-Agent を iOS Safari に上書き（常時）
[MAIN world 注入スクリプト] ──→ document_start で navigator.userAgent / platform / maxTouchPoints 等を上書き
[service-worker のリスナー] ──→ 対象ドメインのタブを検知し、ウィンドウをスマホ縦横比にリサイズ／離脱時に復元
```

## コンポーネント詳細

### 1. 静的 declarativeNetRequest ルール（UA上書き）

- 新規ファイル: `rules/mobile-ua-rules.json`（webpackで dist にコピー）
- ルール内容（1件）:
  - `action.type`: `modifyHeaders`
  - `requestHeaders`: `User-Agent` を `set` で iOS Safari のUA文字列に
  - `condition.requestDomains`: `["tokyo-calendar-date.jp"]`
  - `condition.resourceTypes`: `main_frame`, `sub_frame`, `script`, `xmlhttprequest`, `stylesheet`, `image`, `font`, `media`, `ping`, `websocket`, `other`
- UA文字列（定数化）: iPhone / iOS Safari の標準的なUA
  例: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`
- **利点**: ドメイン固定の常時ルールなので、最初のページ読込時点からモバイルUAになる。手動トグル方式と違い再読込が不要。

### 2. MAIN world 注入スクリプト（JS判定対応）

- 新規エントリ: `src/content/mobile-emulation.ts` → webpack bundle `mobile-emulation.js`
- manifest の `content_scripts` に登録:
  - `matches`: `["https://tokyo-calendar-date.jp/*"]`
  - `run_at`: `document_start`
  - `world`: `MAIN`（ページのJSと同じ実行環境で `navigator` を上書きするため）
- 上書き対象（`Object.defineProperty` で getter 差し替え）:
  - `navigator.userAgent` → モバイルUA（DNRと同一文字列）
  - `navigator.platform` → `iPhone`
  - `navigator.maxTouchPoints` → `5`
  - `navigator.vendor` → `Apple Computer, Inc.`
  - （任意）`navigator.userAgentData` → undefined にして Client Hints 経由のPC判定を防ぐ
- **注意**: document_start かつ MAIN world で確実にページJSより先に実行されること。定数UA文字列は DNR ルールと共通化したいが、JSON とTSで二重管理になるため、TS側を正とし JSON は手動同期（コメントで明記）。

### 3. service-worker: ウィンドウリサイズ管理

新規モジュール `src/background/mobile-window.ts`（service-worker から import）。

- **対象判定**: URLのhostnameが `tokyo-calendar-date.jp` か。判定関数 `isMobileTargetUrl(url)` を用意。
- **リスナー**:
  - `chrome.tabs.onUpdated`: `tab.url` が対象 → そのウィンドウをリサイズ（未適用なら）
  - `chrome.tabs.onActivated`: アクティブになったタブが対象 → リサイズ／対象外 → 復元
  - `chrome.tabs.onRemoved` / `chrome.windows.onRemoved`: 状態クリーンアップ
- **リサイズ仕様**:
  - 対象ウィンドウの元の bounds（`width`, `height`, `left`, `top`）を `chrome.storage.session` に保存（ウィンドウIDをキー）。すでに保存済みなら上書きしない。
  - スマホ縦横比に合わせてリサイズ。目標は content領域が iPhone相当（約 390×844 CSS px）に近づくこと。サイドパネル＋ブラウザUIの占有分を考慮し、調整可能な定数で算出する:
    - `TARGET_WIDTH`（既定 430）, `TARGET_HEIGHT`（既定 860）— ウィンドウ全体サイズの初期値。視覚テスト後にチューニング。
    - 高さは作業領域（ディスプレイ）を超えないようクランプ。
  - 既存の `left`/`top` は維持。
- **復元**: 対象ドメインのタブが閉じられた／対象外URLへ遷移した／対象外タブをアクティブ化したとき、保存した元 bounds に戻す。同一ウィンドウに対象タブが残っている場合は復元しない。

### 4. manifest.json 変更

- `permissions` に `declarativeNetRequest` を追加
- `host_permissions` に `https://tokyo-calendar-date.jp/*` を追加
- `declarative_net_request.rule_resources` に `mobile-ua-rules.json` を登録
- `content_scripts` に MAIN world エントリ（上記2）を追加
- `matches` 等の追加に伴うDNR用ホスト権限は host_permissions で担保

### 5. webpack.config.js 変更

- `entry` に `'mobile-emulation': './src/content/mobile-emulation.ts'` を追加
- `CopyWebpackPlugin` に `rules/mobile-ua-rules.json` のコピー設定を追加

## データフロー

```
ユーザーが tokyo-calendar-date.jp を開く
  │
  ├─ (リクエスト) DNR静的ルールが User-Agent を iOS Safari に上書き → サーバーがモバイル版を返す
  ├─ (document_start) mobile-emulation.js が navigator.* を上書き → ページ内JSのスマホ判定も成立
  └─ (tabs.onUpdated) service-worker がウィンドウをスマホ縦横比にリサイズ（元サイズを session に保存）

ユーザーが別サイトへ移動 / タブを閉じる
  └─ service-worker が元のウィンドウサイズに復元、session の保存をクリア
```

## エラーハンドリング

- ウィンドウ取得・リサイズの各 Chrome API 呼び出しは try-catch で囲み、失敗時は `console.log('[Sidescribe]', ...)` で記録するのみ（致命的にしない）。
- `chrome.storage.session` に元サイズが無い状態での復元要求は無視（既に復元済みとみなす）。
- 対象URL判定は `URL` パースの例外を握りつぶし false を返す。

## テスト・検証

テストフレームワーク未導入のため手動検証:

1. `npm run build` → `chrome://extensions/` でリロード
2. `tokyo-calendar-date.jp` を開く:
   - DevTools Network で main_frame リクエストの `User-Agent` が iOS Safari になっていること
   - コンソールで `navigator.userAgent` / `navigator.maxTouchPoints` がモバイル値であること
   - ウィンドウがスマホ縦横比にリサイズされること
   - ページがモバイル版レイアウトで表示されること
3. 別サイトへ移動 → ウィンドウサイズが元に戻ること
4. 対象外サイトでは一切影響が無いこと（UA・サイズとも通常通り）

## 将来の拡張余地（今回はやらない）

- オプション画面での対象URLリスト編集（ハードコード→設定化）
- メイン画面の手動トグル
- chrome.debugger によるデバイスメトリクス完全エミュレーション（タッチ・DPR・厳密な375px幅）— 黄色い警告バーとのトレードオフ
