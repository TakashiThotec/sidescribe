import { PageMemo, BankTransaction, CardStatement } from '../types';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

class NotionClient {
  private apiKey: string = '';

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    if (!this.apiKey) {
      throw new Error('Notion API key is not configured');
    }

    const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Notion API error: ${response.status} - ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  // ── Memo ──
  async saveMemo(databaseId: string, memo: PageMemo) {
    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Title: {
            title: [{ text: { content: memo.title } }],
          },
          URL: {
            url: memo.url,
          },
          Note: {
            rich_text: [{ text: { content: memo.note || '' } }],
          },
          'Created At': {
            date: { start: memo.createdAt },
          },
        },
      }),
    });
  }

  // ── Bank Transactions (住信SBI) ──
  async saveBankTransaction(databaseId: string, tx: BankTransaction) {
    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Description: {
            title: [{ text: { content: tx.description } }],
          },
          Date: {
            date: { start: tx.date },
          },
          Withdrawal: {
            number: tx.withdrawal ?? null,
          },
          Deposit: {
            number: tx.deposit ?? null,
          },
          Balance: {
            number: tx.balance ?? null,
          },
          Memo: {
            rich_text: [{ text: { content: tx.memo || '' } }],
          },
        },
      }),
    });
  }

  // ── Card Statements ──
  async saveCardStatement(databaseId: string, stmt: CardStatement) {
    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Description: {
            title: [{ text: { content: stmt.description } }],
          },
          Date: {
            date: { start: stmt.date },
          },
          Amount: {
            number: stmt.amount,
          },
          'Card Name': {
            rich_text: [{ text: { content: stmt.cardName } }],
          },
          Category: {
            rich_text: [{ text: { content: stmt.category || '' } }],
          },
        },
      }),
    });
  }
}

export const notion = new NotionClient();
