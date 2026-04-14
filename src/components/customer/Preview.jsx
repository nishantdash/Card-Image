import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { PROVIDERS, buildPreviewPrompt } from '../../lib/providers.js';
import { useGeneration } from '../../lib/useGeneration.js';

export default function Preview() {
  const {
    selections, freeText, cardholderName, setCardholderName,
    cardOrientation, setCardOrientation, source, uploaded,
    variations, selectedVariation, setVariations,
    aiLoading, errorBanner, settings,
  } = useApp();
  const { ensureOrientation } = useGeneration();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const promptPreview = buildPreviewPrompt(selections, freeText) || 'Pick a style to begin…';
  const provDef = PROVIDERS[settings.provider];
  const hasKey = !provDef.needsKey || !!settings.keys[settings.provider];
  const providerText = provDef.label + (hasKey ? ' ✓' : ' (key missing)');

  const pickedVariation = variations?.[selectedVariation];
  let cardImage = '';
  if (pickedVariation && !pickedVariation.failed) {
    cardImage = pickedVariation.cache?.[cardOrientation] || pickedVariation.src || '';
  } else if (source === 'upload' && uploaded) {
    cardImage = uploaded.dataURL;
  }
  useEffect(() => {
    if (!variations?.length) return;
    ensureOrientation(variations, selectedVariation, cardOrientation, setVariations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardOrientation]);

  const displayName = cardholderName?.trim() ? cardholderName.trim().toUpperCase() : 'YOUR NAME';
  const hasSelections = !!(selections.style || selections.mood || selections.color || selections.background);

  return (
    <aside className="preview compact">
      <div className="card-stage">
        <div className="orient-toggle floating" role="tablist" aria-label="Card orientation">
          <button
            className={`orient-btn ${cardOrientation === 'horizontal' ? 'active' : ''}`}
            onClick={() => setCardOrientation('horizontal')}
            aria-label="Horizontal card"
            title="Horizontal"
          ><span className="orient-ic h" aria-hidden="true"></span></button>
          <button
            className={`orient-btn ${cardOrientation === 'vertical' ? 'active' : ''}`}
            onClick={() => setCardOrientation('vertical')}
            aria-label="Vertical card"
            title="Vertical"
          ><span className="orient-ic v" aria-hidden="true"></span></button>
        </div>

        <div className={`card-mock ${cardOrientation === 'vertical' ? 'vertical' : ''}`}>
        <div className="card-art">
          <div
            className={`card-art-image ${cardImage ? 'loaded' : ''}`}
            style={{ backgroundImage: cardImage ? `url("${cardImage}")` : 'none' }}
          ></div>
          <div className={`card-art-loader ${aiLoading ? 'active' : ''}`}>
            <div className="spinner"></div>
          </div>
        </div>
        <div className="card-issuer">AU BANK</div>
        <div className="card-chip-row">
          <div className="card-chip" aria-hidden="true"></div>
          <svg className="card-contactless" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 8a10 10 0 0 1 0 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M9 6a14 14 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M13 4a18 18 0 0 1 0 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </div>
        <div className="card-info">
          <div className="card-number">4024 •••• •••• 8901</div>
          <div className="card-row">
            <div>
              <span className="lbl">Cardholder</span>
              <span className="val">{displayName}</span>
            </div>
            <div>
              <span className="lbl">Expires</span>
              <span className="val">04/30</span>
            </div>
          </div>
        </div>
        <div className="card-brand">VISA</div>
        </div>
      </div>

      <div className="name-input-block">
        <label htmlFor="cardNameInput">Name on card</label>
        <input
          id="cardNameInput"
          type="text"
          placeholder="Tap to enter your name"
          maxLength={22}
          autoComplete="off"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
        />
      </div>

      {errorBanner && (
        <div className="error-banner">{errorBanner}</div>
      )}

      {(hasSelections || freeText) && (
        <div className="preview-details">
          <button
            className="preview-details-toggle"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? 'Hide details ▴' : 'Show details ▾'}
          </button>
          {detailsOpen && (
            <>
              <div className="preview-summary">
                {selections.style && <div className="ps-row"><span>Style</span><strong>{selections.style}</strong></div>}
                {selections.mood && <div className="ps-row"><span>Mood</span><strong>{selections.mood}</strong></div>}
                {selections.color && <div className="ps-row"><span>Palette</span><strong>{selections.color}</strong></div>}
                {selections.background && <div className="ps-row"><span>Background</span><strong>{selections.background}</strong></div>}
              </div>
              <div className="prompt-preview">
                <span className="lbl">AI prompt</span>
                <code>{promptPreview}</code>
              </div>
              <div className="provider-banner">
                <span className="lbl">AI engine</span>
                <strong style={{ color: hasKey ? '' : 'var(--amber)' }}>{providerText}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
