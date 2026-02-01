# 📝 Sidescribe

Webデータを抽出してNotionと同期する、賢いサイドバーChrome拡張機能。

## 機能

### クイックメモ
ワンクリックでページ（URL + タイトル + メモ）をNotionデータベースに保存。

### 銀行同期（住信SBIネット銀行）
- 入出金明細ページからデータを抽出
- Notionの既存データと照合して重複を検出
- 新規取引のみを選択して一括追加

### カード引き落とし（Amex / SMBC）
- American ExpressとSMBCカードの引き落とし額を取得
- セッションストレージに一時保存（複数カードのストック）
- Notionと照合して重複を除外してから追加

### Suica履歴
- モバイルSuicaの利用履歴を取得
- 期間フィルタリング
- CSV出力（freee形式対応）

### Gaba英会話
- レッスン予約・完了一覧の取得
- Google Calendarリンク生成
- Notionへのレッスン登録

## セットアップ

### 前提条件

- Node.js 18以上
- [Notion内部インテグレーション](https://www.notion.so/my-integrations)のトークン

### インストール & ビルド

```bash
npm install
npm run dev    # 開発モード（ウォッチ）
npm run build  # 本番ビルド
```

### Chromeに読み込む

1. `chrome://extensions/` を開く
2. **デベロッパーモード**を有効化
3. **パッケージ化されていない拡張機能を読み込む** → `dist/` フォルダを選択

### 設定

1. Sidescribeアイコンをクリック → ⚙️ 設定
2. Notion APIキーを入力
3. 各機能用のデータベースIDを入力
4. データベースプロパティのマッピングを設定

## Notionデータベースのスキーマ

### メモ用データベース

| プロパティ | 種類           |
|------------|----------------|
| Title      | タイトル       |
| URL        | URL            |
| Note       | リッチテキスト |
| Created At | 日付           |

### 銀行取引データベース

| プロパティ  | 種類           | 用途                     |
|-------------|----------------|--------------------------|
| record      | タイトル       | 取引内容                 |
| date        | 日付           | 取引日                   |
| value       | 数値           | 金額                     |
| flow        | セレクト       | in（入金）/ out（出金）  |

### Gaba用データベース

| プロパティ  | 種類           |
|-------------|----------------|
| Title       | タイトル       |
| Date        | 日付           |
| Time        | リッチテキスト |
| LS          | リッチテキスト |
| Status      | セレクト       |

## 対応サイト

| サービス           | URL                             |
|--------------------|---------------------------------|
| 住信SBIネット銀行  | www.netbk.co.jp                 |
| Gaba英会話         | my.gaba.jp                      |
| モバイルSuica      | www.mobilesuica.com             |
| JR東日本           | www.jreast.co.jp                |
| American Express   | global.americanexpress.com      |
| SMBCカード         | www.smbc-card.com               |

## プロジェクト構成

```
sidescribe/
├── manifest.json           # Chrome拡張 Manifest V3
├── webpack.config.js
├── tsconfig.json
├── src/
│   ├── background/         # Service Worker（メッセージハンドリング）
│   │   └── service-worker.ts
│   ├── sidepanel/          # サイドバーUI（メインインターフェース）
│   │   ├── sidepanel.html
│   │   ├── sidepanel.ts
│   │   └── sidepanel.css
│   ├── options/            # 設定ページ
│   │   ├── options.html
│   │   ├── options.ts
│   │   └── options.css
│   ├── content/            # コンテンツスクリプト（ページDOM抽出）
│   │   └── content.ts
│   ├── modules/            # 外部API連携
│   │   └── notion.ts       # Notion APIクライアント
│   ├── types/              # TypeScript型定義
│   │   └── index.ts
│   └── utils/              # 共有ユーティリティ
│       └── storage.ts
├── icons/
└── dist/                   # ビルド出力（これをChromeに読み込む）
```

## 開発

### ビルドコマンド

```bash
npm run dev    # watchモードで開発
npm run build  # 本番ビルド
npm run clean  # distフォルダをクリア
```

### 拡張機能のリロード

コード変更後は `chrome://extensions/` で拡張機能をリロードする必要がある。

### デバッグ

- Service Worker: `chrome://extensions/` → Sidescribe → 「Service Worker」リンク
- サイドパネル: サイドパネル上で右クリック → 「検証」
- コンテンツスクリプト: 対象ページのDevToolsコンソール

## 技術スタック

- **TypeScript** — 型安全な開発
- **Webpack** — バンドル・ビルド
- **Chrome Extension Manifest V3** — Service Worker、サイドパネルAPI
- **Notion API** — データ保存先

## ライセンス

MIT
