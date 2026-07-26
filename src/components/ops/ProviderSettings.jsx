import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { PROVIDERS, IS_SERVER_ENFORCED, requestGeneration } from '../../lib/providers.js';

export default function ProviderSettings() {
  const { settings, updateSettings } = useApp();
  const [keyVisible, setKeyVisible] = useState(false);
  const [result, setResult] = useState(null); // { tone, msg }
  const [keyDraft, setKeyDraft] = useState(settings.keys?.[settings.provider] || '');
  const [testing, setTesting] = useState(false);

  const def = PROVIDERS[settings.provider] || PROVIDERS.server;
  // In server-enforced mode the browser holds no key, so there is nothing to
  // configure here.
  const needsKey = !IS_SERVER_ENFORCED && def.needsKey;
  const hasKey = !!settings.keys?.[settings.provider];

  const statusClass = IS_SERVER_ENFORCED || !needsKey || hasKey ? 'ok' : 'warn';
  const statusText = IS_SERVER_ENFORCED
    ? 'Server-enforced · key held in GEMINI_API_KEY'
    : !needsKey
      ? `${def.label} · ready`
      : hasKey ? `${def.label} · key configured` : `${def.label} · key required`;

  const changeProvider = (provider) => {
    updateSettings({ ...settings, provider });
    setKeyDraft(settings.keys?.[provider] || '');
  };

  const save = () => {
    updateSettings({
      ...settings,
      keys: { ...settings.keys, [settings.provider]: keyDraft.trim() },
    });
    setResult({ tone: 'ok', msg: `Saved · ${def.label} is now active.` });
  };

  const test = async () => {
    setTesting(true);
    setResult({ tone: '', msg: 'Sending test prompt…' });
    try {
      const out = await requestGeneration({
        settings,
        selections: { style: 'minimal', mood: 'calm', color: 'cool', background: 'abstract' },
        freeText: '',
        cardholderName: 'TEST CARD',
        orientation: 'horizontal',
        inputImage: null,
        variations: 1,
      });
      if (out.refused) {
        setResult({ tone: 'fail', msg: `✕ Guardrails refused the test: ${out.verdict?.decision?.reason}` });
      } else if (out.images.length) {
        setResult({
          tone: 'ok',
          msg: `✓ Connection OK · image received · enforced by ${out.enforcedBy}` +
               ` · decision ${out.verdict?.decision?.code}`,
        });
      } else {
        setResult({ tone: 'fail', msg: `✕ No image returned. ${out.verdict?.error || ''}` });
      }
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
          <p className="muted small">
            {IS_SERVER_ENFORCED
              ? 'Generation runs through /api/generate, which applies the guardrails and holds the provider key.'
              : 'Local direct mode — the browser calls the provider itself. Development only.'}
          </p>
        </div>
        <div className={`settings-status ${statusClass}`}>
          <span className="dot"></span><span>{statusText}</span>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-field">
          <label>Provider</label>
          <select
            value={settings.provider}
            onChange={(e) => changeProvider(e.target.value)}
            disabled={IS_SERVER_ENFORCED}
          >
            {IS_SERVER_ENFORCED ? (
              <option value="server">Server-enforced · Google Gemini</option>
            ) : (
              <>
                <option value="pollinations">Pollinations.ai (free, no key)</option>
                <option value="gemini">Google Gemini · Nano Banana (gemini-2.5-flash-image)</option>
              </>
            )}
          </select>
          {IS_SERVER_ENFORCED && (
            <p className="muted small">
              Set on the server. Change it with the <code>GEMINI_API_KEY</code> environment
              variable in the Vercel project settings.
            </p>
          )}
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
          {needsKey && <button className="btn primary" onClick={save}>Save Settings</button>}
        </div>
      </div>

      <div className="settings-warning">
        {IS_SERVER_ENFORCED ? (
          <>
            <strong>✓ Keys are server-side.</strong> The provider key lives in the
            serverless function's environment and is never sent to the browser.
            Guardrails are re-evaluated on the server for every request, so a
            tampered client cannot skip them.
          </>
        ) : (
          <>
            <strong>⚠ Direct mode.</strong> Keys entered here are stored in{' '}
            <code>localStorage</code> and called straight from the browser, and the
            guardrail decision is made client-side where it can be bypassed. Local
            development only — never deploy in this mode.
          </>
        )}
      </div>

      {result && (
        <div className={`settings-result ${result.tone || ''}`}>{result.msg}</div>
      )}
    </div>
  );
}
