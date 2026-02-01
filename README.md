# 📝 Sidescribe

Your intelligent sidebar scribe — a Chrome extension that extracts web data and syncs with Notion.

## Features

- **Quick Memo** — Save any page (URL + title + note) to a Notion database with one click
- **Bank Sync** — Extract transaction history from 住信SBIネット銀行 and export to Notion
- **Card Statements** — Pull billing data from credit card sites and register in Notion
- **Site-Specific Actions** — Special integrations for Suica, Gaba, and more

## Setup

### Prerequisites

- Node.js 18+
- A [Notion Internal Integration](https://www.notion.so/my-integrations) token

### Install & Build

```bash
npm install
npm run dev    # development (watch mode)
npm run build  # production build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

### Configure

1. Click the Sidescribe icon → ⚙️ Settings
2. Enter your Notion API key
3. Enter the database IDs for each feature

## Notion Database Schemas

### Memo Database

| Property   | Type       |
|------------|------------|
| Title      | Title      |
| URL        | URL        |
| Note       | Rich Text  |
| Created At | Date       |

### Bank Transaction Database

| Property    | Type      |
|-------------|-----------|
| Description | Title     |
| Date        | Date      |
| Withdrawal  | Number    |
| Deposit     | Number    |
| Balance     | Number    |
| Memo        | Rich Text |

### Card Statement Database

| Property    | Type      |
|-------------|-----------|
| Description | Title     |
| Date        | Date      |
| Amount      | Number    |
| Card Name   | Rich Text |
| Category    | Rich Text |

## Project Structure

```
sidescribe/
├── manifest.json           # Chrome Extension Manifest V3
├── webpack.config.js
├── src/
│   ├── background/         # Service Worker
│   ├── sidepanel/          # Sidebar UI (main interface)
│   ├── options/            # Settings page
│   ├── content/            # Content scripts (page data extraction)
│   ├── modules/            # Notion API client, etc.
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Shared utilities
├── icons/
└── dist/                   # Build output (load this in Chrome)
```

## License

MIT
