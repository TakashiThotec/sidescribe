import { SidescribeSettings, DEFAULT_SETTINGS } from '../types';

export async function getSettings(): Promise<SidescribeSettings> {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return result as SidescribeSettings;
}

export async function saveSettings(settings: Partial<SidescribeSettings>): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export function isConfigured(settings: SidescribeSettings): boolean {
  return !!(settings.notionApiKey && settings.memoDatabaseId);
}
