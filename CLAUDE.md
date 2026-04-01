# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Sidescribeは、日本の金融サービス（住信SBIネット銀行、Amex/SMBCカード、Suica）のWebページからデータを抽出し、Notion APIに保存するChrome拡張機能（Manifest V3）。

技術スタック: TypeScript / Webpack / Chrome Extension Manifest V3 / Notion API / Vanilla HTML+CSS（フレームワーク不使用）

## ビルドコマンド

```bash
npm run dev    # watchモードで開発ビルド
npm run build  # 本番ビルド
npm run clean  # dist/を削除
```

テストフレームワークは未導入。ビルド後は`chrome://extensions/`で拡張機能をリロードする必要がある。

## アーキテクチャ

Chrome拡張の3コンテキスト間でメッセージパッシングにより通信する：

```
sidepanel (UI) ←→ service-worker (Notion API) ←→ Notion API
      ↓
content script (DOM抽出)
```

### エントリポイント（Webpackで4バンドル）

| バンドル | ソース | 役割 |
|---|---|---|
| service-worker | `src/background/service-worker.ts` | メッセージルーティング、Notion APIリクエスト処理、設定読み取り |
| sidepanel | `src/sidepanel/sidepanel.ts` | メインUI（タブ切替でメモ/Gaba/Suica/SBI/カードの各機能） |
| content | `src/content/content.ts` | 対象サイトのDOMからデータ抽出（サイト固有の関数群） |
| options | `src/options/options.ts` | 設定画面（APIキー、データベースID、プロパティマッピング） |

### 共有モジュール

- `src/modules/notion.ts` — NotionClient クラス。全APIリクエストを集約
- `src/types/index.ts` — 全TypeScript型定義（MessageAction enum、各データ型、DBマッピングインターフェース）
- `src/utils/storage.ts` — Chrome Storage APIのラッパー

### ストレージ戦略

- **chrome.storage.sync**: APIキー、データベースID、プロパティマッピング等の永続設定
- **chrome.storage.session**: カード請求データ等の一時ストック
- **グローバル変数**: sidepanel.ts内のUIステート

### コンテンツスクリプトのインジェクション

静的（manifest.json）と動的（`chrome.scripting.executeScript`）の併用。`ensureContentScript()`がPINGを送信し、応答なしなら動的インジェクトする。

## 新規サイト対応の追加手順

1. `manifest.json` — `host_permissions`と`content_scripts.matches`に追加
2. `src/content/content.ts` — サイト固有の抽出関数を追加
3. `src/types/index.ts` — データ型とMessageActionを定義
4. `src/sidepanel/sidepanel.ts` — `TAB_CONFIGS`更新＋メッセージハンドラ追加
5. `src/sidepanel/sidepanel.html` — UIタブ追加

## コーディング規約

- 日本語コメント可
- 変数・関数: camelCase（関数は動詞で始める）
- 定数: UPPER_SNAKE_CASE
- CSSクラス: kebab-case（機能名プレフィックス: `gaba-item`, `sbi-status`）
- ログ出力: `console.log('[Sidescribe]')` プレフィックス

## Notion APIプロパティマッピング

データベースのプロパティ名はハードコードせず、`types/index.ts`の`*DbMapping`インターフェース経由でユーザー設定を参照する。設定はオプション画面で行い`chrome.storage.sync`に保存される。

## DOM抽出の注意点

- 複数セレクタ戦略（主要セレクタ→フォールバック）
- 各要素取得を`try-catch`で囲む
- 日付形式は「YYYY/MM/DD」「M月D日」等の複数パターンに対応
- 抽出失敗時は `{ success: false, data: [], error: string }` 形式で返す
