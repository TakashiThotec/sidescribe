import { SidescribeSettings, DEFAULT_SETTINGS } from '../types';

// Storage keys for mappings (separate from DEFAULT_SETTINGS)
const MAPPING_KEYS = [
  'memoDbMapping',
  'bankDbMapping',
  'cardDbMapping',
  'gabaDbMapping',
  'suicaDbMapping',
];

export async function getSettings(): Promise<SidescribeSettings> {
  // Get all keys: default settings + mapping keys
  const keysToGet = { ...DEFAULT_SETTINGS };
  MAPPING_KEYS.forEach(key => {
    (keysToGet as any)[key] = null; // null as default for mappings
  });
  
  const result = await chrome.storage.sync.get(keysToGet);
  return result as SidescribeSettings;
}

export async function saveSettings(settings: Partial<SidescribeSettings>): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export function isConfigured(settings: SidescribeSettings): boolean {
  return !!(settings.notionApiKey && settings.memoDatabaseId);
}
