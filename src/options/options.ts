import './options.css';
import { getSettings, saveSettings } from '../utils/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('settings-form');
const notionApiKey = $<HTMLInputElement>('notion-api-key');
const memoDbId = $<HTMLInputElement>('memo-db-id');
const bankDbId = $<HTMLInputElement>('bank-db-id');
const cardDbId = $<HTMLInputElement>('card-db-id');
const saveStatus = $<HTMLSpanElement>('save-status');

// ── Load settings ──
async function loadSettings() {
  const settings = await getSettings();
  notionApiKey.value = settings.notionApiKey;
  memoDbId.value = settings.memoDatabaseId;
  bankDbId.value = settings.bankTransactionDatabaseId;
  cardDbId.value = settings.cardStatementDatabaseId;
}

// ── Save settings ──
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  await saveSettings({
    notionApiKey: notionApiKey.value.trim(),
    memoDatabaseId: memoDbId.value.trim(),
    bankTransactionDatabaseId: bankDbId.value.trim(),
    cardStatementDatabaseId: cardDbId.value.trim(),
  });

  saveStatus.textContent = '✓ 保存しました';
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 3000);
});

loadSettings();
