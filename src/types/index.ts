// ── Settings ──
export interface SidescribeSettings {
  notionApiKey: string;
  memoDatabaseId: string;
  bankTransactionDatabaseId: string;
  cardStatementDatabaseId: string;
}

export const DEFAULT_SETTINGS: SidescribeSettings = {
  notionApiKey: '',
  memoDatabaseId: '',
  bankTransactionDatabaseId: '',
  cardStatementDatabaseId: '',
};

// ── Memo ──
export interface PageMemo {
  url: string;
  title: string;
  note?: string;
  createdAt: string;
}

// ── Bank Transaction (住信SBI) ──
export interface BankTransaction {
  date: string;
  description: string;
  withdrawal?: number;
  deposit?: number;
  balance?: number;
  memo?: string;
}

// ── Card Statement ──
export interface CardStatement {
  date: string;
  description: string;
  amount: number;
  cardName: string;
  category?: string;
}

// ── Messages (background ↔ sidepanel ↔ content) ──
export type MessageAction =
  | 'GET_PAGE_INFO'
  | 'SAVE_MEMO'
  | 'EXTRACT_BANK_DATA'
  | 'EXTRACT_CARD_DATA'
  | 'OPEN_OPTIONS';

export interface Message {
  action: MessageAction;
  payload?: unknown;
}

export interface PageInfo {
  url: string;
  title: string;
  hostname: string;
}
