import { PageMemo, BankTransaction, CardStatement, GabaLesson, SuicaTransaction, NotionDatabaseProperty, CardBilling } from '../types';

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

  // ── Database Schema ──
  async getDatabaseSchema(databaseId: string): Promise<NotionDatabaseProperty[]> {
    const response = await this.request(`/databases/${databaseId}`);
    const properties: NotionDatabaseProperty[] = [];

    for (const [name, prop] of Object.entries(response.properties as Record<string, { id: string; type: string }>)) {
      properties.push({
        id: prop.id,
        name,
        type: prop.type,
      });
    }

    return properties;
  }

  // ── Memo ──
  async saveMemo(databaseId: string, memo: PageMemo, mapping?: {
    titleProperty?: string;
    urlProperty?: string;
    noteProperty?: string;
    createdAtProperty?: string;
  }) {
    const properties: Record<string, unknown> = {};

    if (mapping?.titleProperty) {
      properties[mapping.titleProperty] = { title: [{ text: { content: memo.title } }] };
    }
    if (mapping?.urlProperty) {
      properties[mapping.urlProperty] = { url: memo.url };
    }
    if (mapping?.createdAtProperty) {
      properties[mapping.createdAtProperty] = { date: { start: memo.createdAt } };
    }

    // ページ本文にNOTEを追加（children blocks）
    const children: unknown[] = [];
    if (memo.note) {
      // 改行で分割して各段落をparagraphブロックとして追加
      const paragraphs = memo.note.split('\n');
      for (const text of paragraphs) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: text } }],
          },
        });
      }
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        ...(children.length > 0 && { children }),
      }),
    });
  }

  // ── Bank Transactions (住信SBI) ──
  // DB構造: record(取引内容), date(日付), value(金額), flow(in/out)
  async saveBankTransaction(databaseId: string, tx: BankTransaction, mapping?: {
    recordProperty?: string;   // 取引内容 (title)
    dateProperty?: string;     // 日付 (date)
    valueProperty?: string;    // 金額 (number)
    flowProperty?: string;     // in/out (select)
  }) {
    const properties: Record<string, unknown> = {};

    // record: 取引内容
    if (mapping?.recordProperty) {
      properties[mapping.recordProperty] = { title: [{ text: { content: tx.description } }] };
    }

    // date: 日付
    if (mapping?.dateProperty) {
      properties[mapping.dateProperty] = { date: { start: tx.date } };
    }

    // value: 金額（入金ならdeposit、出金ならwithdrawal）
    if (mapping?.valueProperty) {
      const value = tx.deposit ?? tx.withdrawal ?? 0;
      properties[mapping.valueProperty] = { number: value };
    }

    // flow: in/out（入金なら"in"、出金なら"out"）
    if (mapping?.flowProperty) {
      const flow = tx.deposit != null ? 'in' : 'out';
      properties[mapping.flowProperty] = { select: { name: flow } };
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });
  }

  // ── Card Statements ──
  async saveCardStatement(databaseId: string, stmt: CardStatement, mapping?: {
    descriptionProperty?: string;
    dateProperty?: string;
    amountProperty?: string;
    cardNameProperty?: string;
    categoryProperty?: string;
  }) {
    const properties: Record<string, unknown> = {};

    if (mapping?.descriptionProperty) {
      properties[mapping.descriptionProperty] = { title: [{ text: { content: stmt.description } }] };
    }
    if (mapping?.dateProperty) {
      properties[mapping.dateProperty] = { date: { start: stmt.date } };
    }
    if (mapping?.amountProperty) {
      properties[mapping.amountProperty] = { number: stmt.amount };
    }
    if (mapping?.cardNameProperty) {
      properties[mapping.cardNameProperty] = { rich_text: [{ text: { content: stmt.cardName } }] };
    }
    if (mapping?.categoryProperty && stmt.category) {
      properties[mapping.categoryProperty] = { rich_text: [{ text: { content: stmt.category } }] };
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });
  }

  // ── Gaba Lessons ──
  async saveGabaLesson(databaseId: string, lesson: GabaLesson, mapping?: {
    titleProperty?: string;
    dateProperty?: string;
    timeProperty?: string;
    lsProperty?: string;
    statusProperty?: string;
  }) {
    // Parse date and time
    const dateMatch = lesson.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const timeMatch = lesson.time.match(/(\d{1,2}):(\d{2})/);

    if (!dateMatch || !timeMatch) {
      throw new Error('Invalid date or time format');
    }

    const year = parseInt(dateMatch[1]);
    const month = String(parseInt(dateMatch[2])).padStart(2, '0');
    const day = String(parseInt(dateMatch[3])).padStart(2, '0');
    const hour = String(parseInt(timeMatch[1])).padStart(2, '0');
    const minute = timeMatch[2];

    // Create start and end times (40 min lesson)
    const startTime = `${year}-${month}-${day}T${hour}:${minute}:00`;
    const endDate = new Date(year, parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]), parseInt(timeMatch[1]), parseInt(timeMatch[2]) + 40);
    const endHour = String(endDate.getHours()).padStart(2, '0');
    const endMinute = String(endDate.getMinutes()).padStart(2, '0');
    const endTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${endHour}:${endMinute}:00`;

    const title = `【Gaba】レッスン（${lesson.time}）`;

    const properties: Record<string, unknown> = {};

    if (mapping?.titleProperty) {
      properties[mapping.titleProperty] = { title: [{ text: { content: title } }] };
    }
    if (mapping?.dateProperty) {
      properties[mapping.dateProperty] = {
        date: {
          start: startTime,
          end: endTime,
          time_zone: 'Asia/Tokyo',
        },
      };
    }
    if (mapping?.timeProperty) {
      properties[mapping.timeProperty] = { rich_text: [{ text: { content: lesson.time } }] };
    }
    if (mapping?.lsProperty && lesson.ls) {
      properties[mapping.lsProperty] = { rich_text: [{ text: { content: lesson.ls } }] };
    }
    if (mapping?.statusProperty) {
      properties[mapping.statusProperty] = { select: { name: lesson.status === 'completed' ? 'Completed' : 'Reserved' } };
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });
  }

  // ── Suica Transactions ──
  async saveSuicaTransaction(databaseId: string, tx: SuicaTransaction, mapping?: {
    descriptionProperty?: string;
    dateProperty?: string;
    amountProperty?: string;
    balanceProperty?: string;
  }) {
    const properties: Record<string, unknown> = {};

    if (mapping?.descriptionProperty) {
      properties[mapping.descriptionProperty] = { title: [{ text: { content: tx.details } }] };
    }
    if (mapping?.dateProperty) {
      properties[mapping.dateProperty] = { date: { start: tx.date } };
    }
    if (mapping?.amountProperty) {
      properties[mapping.amountProperty] = { number: tx.amount };
    }
    if (mapping?.balanceProperty && tx.balance) {
      properties[mapping.balanceProperty] = { rich_text: [{ text: { content: tx.balance } }] };
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });
  }

  // ── Get Bank Transactions from Notion ──
  // DB構造: record(取引内容), date(日付), value(金額), flow(in/out)
  async getBankTransactions(
    databaseId: string,
    startDate: string,
    endDate: string,
    mapping?: {
      recordProperty?: string;   // 取引内容 (title)
      dateProperty?: string;     // 日付 (date)
      valueProperty?: string;    // 金額 (number)
      flowProperty?: string;     // in/out (select)
    }
  ): Promise<BankTransaction[]> {
    if (!mapping?.dateProperty) {
      throw new Error('Date property mapping is required');
    }

    // Notion Database Query with date filter
    const filter = {
      and: [
        {
          property: mapping.dateProperty,
          date: {
            on_or_after: startDate,
          },
        },
        {
          property: mapping.dateProperty,
          date: {
            on_or_before: endDate,
          },
        },
      ],
    };

    const response = await this.request(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        filter,
        sorts: [
          {
            property: mapping.dateProperty,
            direction: 'descending',
          },
        ],
        page_size: 100,
      }),
    });

    const transactions: BankTransaction[] = [];

    for (const page of response.results) {
      const props = page.properties;

      // Extract date
      let date = '';
      if (mapping.dateProperty && props[mapping.dateProperty]?.date?.start) {
        date = props[mapping.dateProperty].date.start.split('T')[0]; // YYYY-MM-DD
      }

      // Extract record (取引内容 - title property)
      let description = '';
      if (mapping.recordProperty && props[mapping.recordProperty]?.title) {
        description = props[mapping.recordProperty].title
          .map((t: { plain_text: string }) => t.plain_text)
          .join('');
      }

      // Extract value (金額) and flow (in/out)
      let withdrawal: number | undefined;
      let deposit: number | undefined;

      const value = mapping.valueProperty && props[mapping.valueProperty]?.number != null
        ? props[mapping.valueProperty].number
        : 0;

      // flowが"in"なら入金、"out"なら出金
      const flow = mapping.flowProperty && props[mapping.flowProperty]?.select?.name;
      if (flow === 'in') {
        deposit = value;
      } else if (flow === 'out') {
        withdrawal = value;
      }

      if (date) {
        transactions.push({
          date,
          description,
          withdrawal,
          deposit,
        });
      }
    }

    return transactions;
  }

  // ── Save Card Billing to Bank Transaction DB ──
  // カード引き落としを銀行明細DBに保存（outとして）
  async saveCardBilling(
    databaseId: string,
    billing: CardBilling,
    mapping?: {
      recordProperty?: string;   // 取引内容 (title)
      dateProperty?: string;     // 日付 (date)
      valueProperty?: string;    // 金額 (number)
      flowProperty?: string;     // in/out (select)
    }
  ) {
    const properties: Record<string, unknown> = {};

    // 支払い日をYYYY-MM-DD形式に変換
    // 「02月10日」→ 今年の日付として「2026-02-10」
    const currentYear = new Date().getFullYear();
    const dateMatch = billing.paymentDate.match(/(\d{1,2})月(\d{1,2})日/);
    let dateStr = '';
    if (dateMatch) {
      const month = String(parseInt(dateMatch[1])).padStart(2, '0');
      const day = String(parseInt(dateMatch[2])).padStart(2, '0');
      dateStr = `${currentYear}-${month}-${day}`;
    }

    // record: カード名 + 引き落とし
    if (mapping?.recordProperty) {
      const description = `${billing.cardName} 引き落とし`;
      properties[mapping.recordProperty] = { title: [{ text: { content: description } }] };
    }

    // date: 支払い日
    if (mapping?.dateProperty && dateStr) {
      properties[mapping.dateProperty] = { date: { start: dateStr } };
    }

    // value: 金額
    if (mapping?.valueProperty) {
      properties[mapping.valueProperty] = { number: billing.amount };
    }

    // flow: out（引き落とし）
    if (mapping?.flowProperty) {
      properties[mapping.flowProperty] = { select: { name: 'out' } };
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });
  }
}

export const notion = new NotionClient();
