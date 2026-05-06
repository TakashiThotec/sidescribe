// ── Notion Database Property ──
export interface NotionDatabaseProperty {
  id: string;
  name: string;
  type: string;
}

// ── Database Property Mappings ──
export interface MemoDbMapping {
  titleProperty: string;
  urlProperty: string;
  noteProperty: string;
  createdAtProperty: string;
}

export interface BankDbMapping {
  recordProperty: string;    // 取引内容 (title)
  dateProperty: string;      // 日付 (date)
  valueProperty: string;     // 金額 (number)
  flowProperty: string;      // in/out (select)
}

export interface CardDbMapping {
  descriptionProperty: string;
  dateProperty: string;
  amountProperty: string;
  cardNameProperty: string;
  categoryProperty: string;
}

export interface SuicaDbMapping {
  descriptionProperty: string;
  dateProperty: string;
  amountProperty: string;
  balanceProperty: string;
}

export interface CalendarDbMapping {
  titleProperty: string;
  dateProperty: string;
}

export interface CalendarEvent {
  title: string;
  date: string;       // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD (multi-day events)
}

// ── Settings ──
export interface SidescribeSettings {
  notionApiKey: string;
  memoDatabaseId: string;
  bankTransactionDatabaseId: string;
  cardStatementDatabaseId: string;
  suicaDatabaseId: string;
  calendarDatabaseId: string;
  // Database property mappings
  memoDbMapping?: MemoDbMapping;
  bankDbMapping?: BankDbMapping;
  cardDbMapping?: CardDbMapping;
  suicaDbMapping?: SuicaDbMapping;
  calendarDbMapping?: CalendarDbMapping;
}

export const DEFAULT_SETTINGS: SidescribeSettings = {
  notionApiKey: '',
  memoDatabaseId: '',
  bankTransactionDatabaseId: '',
  cardStatementDatabaseId: '',
  suicaDatabaseId: '',
  calendarDatabaseId: '',
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

// ── Suica Transaction ──
export interface SuicaTransaction {
  date: string;        // "YYYY-MM-DD"
  amount: number;
  details: string;
  balance?: string;
}

// ── Card Billing (カード引き落とし額) ──
export interface CardBilling {
  cardCompany: 'amex' | 'smbc';
  cardName: string;          // カード名（Amex: ゴールド、プラチナ等 / SMBC: カード名）
  paymentDate: string;       // 引き落とし日 (例: "2月26日")
  amount: number;            // 引き落とし金額
  isConfirmed: boolean;      // 確定済みかどうか
  fetchedAt: string;         // 取得日時
}

// ── Card Billing Group (カードごとのグループ) ──
export interface CardBillingGroup {
  id: string;                 // ユニークID (cardCompany + cardName のハッシュ)
  cardCompany: 'amex' | 'smbc';
  cardName: string;
  billings: CardBilling[];
  fetchedAt: string;          // 最終取得日時
}

// ── Card Billing Stock (セッションストレージ用) ──
export interface CardBillingStock {
  groups: CardBillingGroup[];
  lastUpdated: string;
}

// ── Tab Type ──
export type TabType = 'memo' | 'suica' | 'sbi' | 'card' | 'x' | 'ana';

// ── Messages (background ↔ sidepanel ↔ content) ──
export type MessageAction =
  | 'PING'
  | 'GET_PAGE_INFO'
  | 'SAVE_MEMO'
  | 'EXTRACT_BANK_DATA'
  | 'EXTRACT_CARD_DATA'
  | 'OPEN_OPTIONS'
  // Suica
  | 'GET_SUICA_DATA'
  | 'SAVE_SUICA_TRANSACTIONS'
  // SBI Bank
  | 'GET_SBI_BANK_DATA'
  | 'GET_NOTION_BANK_DATA'
  | 'SAVE_BANK_TRANSACTIONS'
  // Card Billing
  | 'GET_CARD_BILLING'
  | 'CHECK_CARD_BILLING_DUPLICATES'
  | 'SAVE_CARD_BILLING'
  // Tab context
  | 'TAB_CONTEXT_CHANGED'
  // X/Twitter
  | 'X_GET_STATUS'
  | 'X_HIDE_FOR_YOU'
  | 'X_SWITCH_TO_FOR_YOU'
  | 'X_SWITCH_TO_FOLLOWING'
  // Calendar
  | 'GET_CALENDAR_EVENTS';

export interface Message {
  action: MessageAction;
  payload?: unknown;
}

export interface PageInfo {
  url: string;
  title: string;
  hostname: string;
}
