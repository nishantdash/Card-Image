const SETTINGS_KEY = 'hyperface.aiProvider';

// Keys supplied at build time via .env (VITE_-prefixed vars are inlined into the
// client bundle by Vite). These act as defaults so the demo works out of the box
// without anyone pasting a key into the Ops Dashboard. A key typed into the UI
// (persisted in localStorage) still takes precedence.
const ENV_KEYS = {};
if (import.meta.env.VITE_GEMINI_API_KEY)    ENV_KEYS.gemini    = import.meta.env.VITE_GEMINI_API_KEY;
if (import.meta.env.VITE_OPENAI_API_KEY)    ENV_KEYS.dalle     = import.meta.env.VITE_OPENAI_API_KEY;
if (import.meta.env.VITE_STABILITY_API_KEY) ENV_KEYS.stability = import.meta.env.VITE_STABILITY_API_KEY;
if (import.meta.env.VITE_XAI_API_KEY)       ENV_KEYS.grok      = import.meta.env.VITE_XAI_API_KEY;

// When a Gemini key is provided via .env, default the whole app to Gemini so the
// demo uses the higher-quality provider (and true photo stylization) automatically.
const DEFAULT_PROVIDER = ENV_KEYS.gemini ? 'gemini' : 'pollinations';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { provider: DEFAULT_PROVIDER, keys: { ...ENV_KEYS } };
    const parsed = JSON.parse(raw);
    return {
      provider: parsed.provider || DEFAULT_PROVIDER,
      keys: { ...ENV_KEYS, ...(parsed.keys || {}) },
    };
  } catch {
    return { provider: DEFAULT_PROVIDER, keys: { ...ENV_KEYS } };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
