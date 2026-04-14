const SETTINGS_KEY = 'hyperface.aiProvider';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { provider: 'pollinations', keys: {} };
    const parsed = JSON.parse(raw);
    return { provider: parsed.provider || 'pollinations', keys: parsed.keys || {} };
  } catch {
    return { provider: 'pollinations', keys: {} };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
