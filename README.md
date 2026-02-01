# 📝 Sidescribe

Webデータを抽出してNotionと同期する、賢いサイドバーChrome拡張機能。

## 機能

- **クイックメモ** — ワンクリックでページ（URL + タイトル + メモ）をNotionデータベースに保存
- **銀行同期** — 住信SBIネット銀行から取引履歴を抽出してNotionにエクスポート
- **カード明細** — クレジットカードサイトから請求データを取得してNotionに登録
- **サイト固有アクション** — Suica、Gabaなど向けの特別な連携

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

## Notionデータベースのスキーマ

### メモ用データベース

| プロパティ | 種類           |
|------------|----------------|
| Title      | タイトル       |
| URL        | URL            |
| Note       | リッチテキスト |
| Created At | 日付           |

### 銀行取引データベース

| プロパティ  | 種類           |
|-------------|----------------|
| Description | タイトル       |
| Date        | 日付           |
| Withdrawal  | 数値（出金）   |
| Deposit     | 数値（入金）   |
| Balance     | 数値（残高）   |
| Memo        | リッチテキスト |

### カード明細データベース

| プロパティ  | 種類           |
|-------------|----------------|
| Description | タイトル       |
| Date        | 日付           |
| Amount      | 数値           |
| Card Name   | リッチテキスト |
| Category    | リッチテキスト |

## プロジェクト構成

```
sidescribe/
├── manifest.json           # Chrome拡張 Manifest V3
├── webpack.config.js
├── src/
│   ├── background/         # Service Worker
│   ├── sidepanel/          # サイドバーUI（メインインターフェース）
│   ├── options/            # 設定ページ
│   ├── content/            # コンテンツスクリプト（ページデータ抽出）
│   ├── modules/            # Notion APIクライアントなど
│   ├── types/              # TypeScript型定義
│   └── utils/              # 共有ユーティリティ
├── icons/
└── dist/                   # ビルド出力（これをChromeに読み込む）
```

## ライセンス

MIT
