import './options.css';
import { getSettings, saveSettings } from '../utils/storage';
import { notion } from '../modules/notion';
import { NotionDatabaseProperty } from '../types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('settings-form');
const notionApiKey = $<HTMLInputElement>('notion-api-key');
const memoDbId = $<HTMLInputElement>('memo-db-id');
const bankDbId = $<HTMLInputElement>('bank-db-id');
const cardDbId = $<HTMLInputElement>('card-db-id');
const saveStatus = $<HTMLSpanElement>('save-status');

// ── DB Mapping configurations ──
interface DbConfig {
  inputId: string;
  fetchBtnId: string;
  mappingPanelId: string;
  mappingKey: string;
  mappingFields: { selectId: string; expectedType: string; fieldKey: string }[];
}

const dbConfigs: Record<string, DbConfig> = {
  memo: {
    inputId: 'memo-db-id',
    fetchBtnId: 'memo-fetch-schema',
    mappingPanelId: 'memo-mapping',
    mappingKey: 'memoDbMapping',
    mappingFields: [
      { selectId: 'memo-map-title', expectedType: 'title', fieldKey: 'titleProperty' },
      { selectId: 'memo-map-url', expectedType: 'url', fieldKey: 'urlProperty' },
      { selectId: 'memo-map-note', expectedType: 'rich_text', fieldKey: 'noteProperty' },
      { selectId: 'memo-map-created', expectedType: 'date', fieldKey: 'createdAtProperty' },
    ],
  },
  bank: {
    inputId: 'bank-db-id',
    fetchBtnId: 'bank-fetch-schema',
    mappingPanelId: 'bank-mapping',
    mappingKey: 'bankDbMapping',
    mappingFields: [
      { selectId: 'bank-map-record', expectedType: 'title', fieldKey: 'recordProperty' },
      { selectId: 'bank-map-date', expectedType: 'date', fieldKey: 'dateProperty' },
      { selectId: 'bank-map-value', expectedType: 'number', fieldKey: 'valueProperty' },
      { selectId: 'bank-map-flow', expectedType: 'select', fieldKey: 'flowProperty' },
    ],
  },
  card: {
    inputId: 'card-db-id',
    fetchBtnId: 'card-fetch-schema',
    mappingPanelId: 'card-mapping',
    mappingKey: 'cardDbMapping',
    mappingFields: [
      { selectId: 'card-map-description', expectedType: 'title', fieldKey: 'descriptionProperty' },
      { selectId: 'card-map-date', expectedType: 'date', fieldKey: 'dateProperty' },
      { selectId: 'card-map-amount', expectedType: 'number', fieldKey: 'amountProperty' },
      { selectId: 'card-map-cardname', expectedType: 'rich_text', fieldKey: 'cardNameProperty' },
      { selectId: 'card-map-category', expectedType: 'rich_text', fieldKey: 'categoryProperty' },
    ],
  },
};

// ── Read-only property types that cannot be written to ──
const READ_ONLY_PROPERTY_TYPES = ['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by'];

// ── Populate select with schema properties ──
function populateSelect(
  select: HTMLSelectElement,
  properties: NotionDatabaseProperty[],
  expectedType: string,
  savedValue?: string
) {
  select.innerHTML = '<option value="">-- 選択しない --</option>';

  // 書き込み不可のプロパティ（関数、ロールアップ等）は除外
  const writableProperties = properties.filter((p) => !READ_ONLY_PROPERTY_TYPES.includes(p.type));

  const matchingProps = writableProperties.filter((p) => p.type === expectedType);
  const otherProps = writableProperties.filter((p) => p.type !== expectedType);

  if (matchingProps.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = `推奨 (${expectedType})`;
    matchingProps.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name;
      if (savedValue === p.name) option.selected = true;
      optgroup.appendChild(option);
    });
    select.appendChild(optgroup);
  }

  if (otherProps.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = 'その他';
    otherProps.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = `${p.name} (${p.type})`;
      if (savedValue === p.name) option.selected = true;
      optgroup.appendChild(option);
    });
    select.appendChild(optgroup);
  }
}

// ── Fetch schema and show mapping panel ──
async function fetchSchemaAndShowPanel(dbKey: string) {
  const config = dbConfigs[dbKey];
  const dbIdInput = $<HTMLInputElement>(config.inputId);
  const fetchBtn = $<HTMLButtonElement>(config.fetchBtnId);
  const mappingPanel = $<HTMLDivElement>(config.mappingPanelId);

  const dbId = dbIdInput.value.trim();
  if (!dbId) {
    alert('Database IDを入力してください');
    return;
  }

  const apiKey = notionApiKey.value.trim();
  if (!apiKey) {
    alert('Notion API Keyを入力してください');
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.textContent = '取得中...';

  try {
    notion.setApiKey(apiKey);
    const properties = await notion.getDatabaseSchema(dbId);

    // Clear mapping (reset) and populate selects
    config.mappingFields.forEach((field) => {
      const select = $<HTMLSelectElement>(field.selectId);
      populateSelect(select, properties, field.expectedType);
    });

    // Show mapping panel
    mappingPanel.style.display = 'block';

    // Clear saved mapping in storage (empty object)
    await saveSettings({ [config.mappingKey]: {} } as any);

    showStatus('スキーマ取得完了 - マッピングを設定してください');
  } catch (error: any) {
    alert(`スキーマ取得エラー: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = '🔄 スキーマ取得';
  }
}

// ── Save mapping for a DB ──
async function saveMappingForDb(dbKey: string) {
  const config = dbConfigs[dbKey];
  const mapping: Record<string, string> = {};

  config.mappingFields.forEach((field) => {
    const select = $<HTMLSelectElement>(field.selectId);
    if (select.value) {
      mapping[field.fieldKey] = select.value;
    }
  });

  // Always save as object (empty object means no mapping)
  await saveSettings({ [config.mappingKey]: mapping } as any);
  
  console.log(`[Sidescribe] Saved mapping for ${dbKey}:`, mapping);
  showStatus('✓ マッピング保存完了');
}

// ── Show status message ──
function showStatus(message: string) {
  saveStatus.textContent = message;
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
}

// ── Setup fetch schema buttons ──
function setupFetchSchemaButtons() {
  Object.entries(dbConfigs).forEach(([dbKey, config]) => {
    const fetchBtn = $<HTMLButtonElement>(config.fetchBtnId);
    fetchBtn.addEventListener('click', () => fetchSchemaAndShowPanel(dbKey));
  });
}

// ── Setup mapping select listeners ──
function setupMappingSelectListeners() {
  Object.entries(dbConfigs).forEach(([dbKey, config]) => {
    config.mappingFields.forEach((field) => {
      const select = $<HTMLSelectElement>(field.selectId);
      select.addEventListener('change', () => saveMappingForDb(dbKey));
    });
  });
}

// ── Load settings ──
async function loadSettings() {
  const settings = await getSettings();
  notionApiKey.value = settings.notionApiKey;
  memoDbId.value = settings.memoDatabaseId;
  bankDbId.value = settings.bankTransactionDatabaseId;
  cardDbId.value = settings.cardStatementDatabaseId;
  // Set API key for Notion client
  if (settings.notionApiKey) {
    notion.setApiKey(settings.notionApiKey);
  }

  // Show saved mappings (without fetching schema)
  const mappings: Record<string, Record<string, string> | undefined> = {
    memo: settings.memoDbMapping as any,
    bank: settings.bankDbMapping as any,
    card: settings.cardDbMapping as any,
  };

  console.log('[Sidescribe] Loaded mappings:', mappings);

  Object.entries(dbConfigs).forEach(([dbKey, config]) => {
    const mapping = mappings[dbKey];
    const mappingPanel = $<HTMLDivElement>(config.mappingPanelId);

    // Check if mapping has any values
    const hasMapping = mapping && Object.keys(mapping).length > 0 && 
      Object.values(mapping).some(v => v && v.length > 0);

    if (hasMapping) {
      // Show panel with saved values (as simple options)
      mappingPanel.style.display = 'block';
      config.mappingFields.forEach((field) => {
        const select = $<HTMLSelectElement>(field.selectId);
        const savedValue = mapping[field.fieldKey];
        if (savedValue) {
          select.innerHTML = `<option value="${savedValue}" selected>${savedValue} (保存済み)</option><option value="">-- 選択しない --</option>`;
        } else {
          select.innerHTML = '<option value="">-- 選択しない --</option>';
        }
      });
    } else {
      // No mapping - hide panel
      mappingPanel.style.display = 'none';
    }
  });
}

// ── Save all settings ──
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  await saveSettings({
    notionApiKey: notionApiKey.value.trim(),
    memoDatabaseId: memoDbId.value.trim(),
    bankTransactionDatabaseId: bankDbId.value.trim(),
    cardStatementDatabaseId: cardDbId.value.trim(),
  });

  showStatus('✓ 保存しました');
});

// ── Initialize ──
setupFetchSchemaButtons();
setupMappingSelectListeners();
loadSettings();
