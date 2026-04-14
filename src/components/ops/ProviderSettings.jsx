import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { PROVIDERS, callProvider } from '../../lib/providers.js';

export default function ProviderSettings() {
  const { settings, updateSettings } = useApp();
  const [keyVisible, setKeyVisible] = useState(false);
  const [result, setResult] = useState(null); // { tone, msg }
  const [keyDraft, setKeyDraft] = useState(settings.keys[settings.provider] || '');
  const [testing, setTesting] = useState(false);

  const def = PROVIDERS[settings.provider];
  const needsKey = def.needsKey;
  const hasKey = !!settings.keys[settings.provider];

  const statusClass = !needsKey || hasKey ? 'ok' : 'warn';
  const statusText = !needsKey
    ? `${def.label} · ready`
    : hasKey
      ? `${def.label} · key configured`
      : `${def.label} · key required`;

  const changeProvider = (provider) => {
    updateSettings({ ...settings, provider });
    setKeyDraft(settings.keys[provider] || '');
  };

  const save = () => {
    const next = { ...settings, keys: { ...settings.keys, [settings.provider]: keyDraft.trim() } };
    updateSettings(next);
    setResult({ tone: 'ok', msg: `Saved · ${def.label} is now active.` });
  };

  const test = async () => {
    const next = { ...settings, keys: { ...settings.keys, [settings.provider]: keyDraft.trim() } };
    updateSettings(next);
    setTesting(true);
    setResult({ tone: '', msg: 'Sending test prompt…' });
    try {
      const { src } = await callProvider(next, 'a minimal abstract gradient, blue and purple, test image', null, 'horizontal', { current: null });
      setResult({ tone: 'ok', msg: `✓ Connection OK · received image (${src.slice(0, 60)}…)` });
    } catch (err) {
      setResult({ tone: 'fail', msg: `✕ ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-head">
        <div>
          <h2>AI Image Provider</h2>
          <p className="muted small">Choose which model generates customer card artwork. Settings persist locally.</p>
        </div>
        <div className={`settings-status ${statusClass}`}>
          <span className="dot"></span><span>{statusText}</span>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-field">
          <label>Provider</label>
          <select value={settings.provider} onChange={(e) => changeProvider(e.target.value)}>
            <option value="pollinations">Pollinations.ai (free, no key)</option>
            <option value="gemini">Google Gemini · Nano Banana (gemini-2.5-flash-image)</option>
            <option value="dalle">OpenAI DALL·E 3</option>
            <option value="grok">xAI Grok Image (grok-2-image)</option>
            <option value="stability">Stability AI (Stable Diffusion 3)</option>
          </select>
        </div>

        {needsKey && (
          <div className="settings-field">
            <label>API Key <span className="muted">{def.keyHint}</span></label>
            <div className="key-input-row">
              <input
                type={keyVisible ? 'text' : 'password'}
                placeholder="Paste your API key"
                autoComplete="off"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button className="btn-icon" onClick={() => setKeyVisible(v => !v)} title="Show/hide">👁</button>
            </div>
          </div>
        )}

        <div className="settings-actions">
          <button className="btn ghost" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button className="btn primary" onClick={save}>Save Settings</button>
        </div>
      </div>

      <div className="settings-warning">
        <strong>⚠ Security note:</strong> API keys entered here are stored in <code>localStorage</code> and called directly from the browser. This is fine for sandbox/demo use, but in production keys must live behind a server-side proxy — never ship them to the client.
      </div>

      {result && (
        <div className={`settings-result ${result.tone || ''}`}>{result.msg}</div>
      )}
    </div>
  );
}
