const SETTINGS_KEY = 'hyperface.aiProvider';

// Provider configuration.
//
// In the default (deployed) mode the browser holds no key at all: generation goes
// through /api/generate, which reads GEMINI_API_KEY server-side. The previous
// version inlined VITE_GEMINI_API_KEY into the public bundle, where it was
// readable in devtools on the live site.
//
// The direct-to-provider path survives for local development only, gated on
// VITE_ALLOW_DIRECT_PROVIDER *and* import.meta.env.DEV, so a production build
// cannot fall back into it.
const DIRECT_MODE =
  import.meta.env.VITE_ALLOW_DIRECT_PROVIDER === 'true' && import.meta.env.DEV;

const ENV_KEYS = {};
if (DIRECT_MODE) {
  if (import.meta.env.VITE_GEMINI_API_KEY)    ENV_KEYS.gemini    = import.meta.env.VITE_GEMINI_API_KEY;
  if (import.meta.env.VITE_OPENAI_API_KEY)    ENV_KEYS.dalle     = import.meta.env.VITE_OPENAI_API_KEY;
  if (import.meta.env.VITE_STABILITY_API_KEY) ENV_KEYS.stability = import.meta.env.VITE_STABILITY_API_KEY;
  if (import.meta.env.VITE_XAI_API_KEY)       ENV_KEYS.grok      = import.meta.env.VITE_XAI_API_KEY;
}

const DEFAULT_PROVIDER = DIRECT_MODE ? (ENV_KEYS.gemini ? 'gemini' : 'pollinations') : 'server';

export const IS_DIRECT_MODE = DIRECT_MODE;

export function loadSettings() {
  const fallback = { provider: DEFAULT_PROVIDER, keys: { ...ENV_KEYS } };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // A provider persisted from an earlier session must not drag a
    // server-enforced build back into direct mode.
    const provider = DIRECT_MODE ? (parsed.provider || DEFAULT_PROVIDER) : 'server';
    return {
      provider,
      keys: { ...ENV_KEYS, ...(DIRECT_MODE ? parsed.keys || {} : {}) },
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private browsing / quota — settings simply do not persist */
  }
}
