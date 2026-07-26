import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cardAspect } from '../../../shared/cardGeometry.js';
import { renderCrop, measure } from '../../lib/cardImage.js';

// Crop an uploaded photo before generation.
//
// The frame is locked to the card's aspect ratio, so what the customer positions
// here is exactly what lands on the card — no surprise re-crop later. Without
// this step the photo was centre-cropped silently and faces ended up half out of
// frame.
//
// Pointer events rather than separate mouse/touch handlers, and a zoom slider
// rather than pinch: a slider is reliable on every phone and does not fight the
// page's own scroll gestures.

const MAX_ZOOM = 4;

export default function ImageCropper({ src, orientation = 'horizontal', onApply, onCancel }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);

  const [natural, setNatural] = useState(null);       // { width, height }
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // frame-space pixels
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const aspect = cardAspect(orientation);

  useEffect(() => {
    let cancelled = false;
    measure(src)
      .then(d => { if (!cancelled) setNatural(d); })
      .catch(() => { if (!cancelled) setError('That photo could not be opened.'); });
    return () => { cancelled = true; };
  }, [src]);

  // Frame size is driven by CSS (responsive), so it has to be measured.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setFrame({ w: r.width, h: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);

  // Reset framing when the photo or orientation changes.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [src, orientation]);

  // Scale at which the image exactly covers the frame — zoom multiplies this, so
  // zoom=1 is always "no gaps".
  const baseScale = natural && frame.w
    ? Math.max(frame.w / natural.width, frame.h / natural.height)
    : 1;
  const scale = baseScale * zoom;

  const drawW = natural ? natural.width * scale : 0;
  const drawH = natural ? natural.height * scale : 0;

  // Keep the frame covered: the image may never reveal a gap at an edge.
  const clamp = useCallback((next) => {
    const maxX = Math.max(0, (drawW - frame.w) / 2);
    const maxY = Math.max(0, (drawH - frame.h) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, [drawW, drawH, frame.w, frame.h]);

  useEffect(() => { setOffset(o => clamp(o)); }, [clamp]);

  const onPointerDown = (e) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, start: { ...offset } };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    setOffset(clamp({
      x: d.start.x + (e.clientX - d.x),
      y: d.start.y + (e.clientY - d.y),
    }));
  };
  const endDrag = () => { dragRef.current = null; };

  // Frame -> source pixels. The image sits centred plus `offset`, so the frame's
  // top-left maps back through the same transform.
  const apply = async () => {
    if (!natural || !frame.w) return;
    setBusy(true);
    setError(null);
    try {
      const left = (frame.w - drawW) / 2 + offset.x;
      const top = (frame.h - drawH) / 2 + offset.y;
      const rect = {
        sx: Math.round(-left / scale),
        sy: Math.round(-top / scale),
        sw: Math.round(frame.w / scale),
        sh: Math.round(frame.h / scale),
      };
      const out = await renderCrop(src, rect, orientation);
      onApply(out);
    } catch (err) {
      setError(err.message || 'Could not apply the crop.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  return (
    <div className="cropper">
      <h3>Position your photo</h3>
      <p className="muted small">
        Drag to move, use the slider to zoom. This is exactly how it will appear on
        your card.
      </p>

      <div
        className="cropper-frame"
        ref={frameRef}
        style={{ aspectRatio: `${aspect} / 1` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        role="application"
        aria-label="Crop area — drag to reposition your photo"
      >
        {natural && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="cropper-img"
            style={{
              width: `${drawW}px`,
              height: `${drawH}px`,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        )}
        {/* Guides for the zones the embosser reserves, so the customer can keep a
            face clear of the card number and chip. */}
        <div className="cropper-guides" aria-hidden="true">
          <span className="guide-chip" />
          <span className="guide-strip" />
        </div>
      </div>

      <div className="cropper-controls">
        <label htmlFor="cropZoom" className="cropper-zoom-label">Zoom</label>
        <input
          id="cropZoom"
          type="range"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          disabled={!natural}
        />
        <button className="btn ghost small" onClick={reset} disabled={!natural}>Reset</button>
      </div>

      {natural && (
        <p className="muted small cropper-meta">
          Source {natural.width}×{natural.height}
          {/* Zooming in reads fewer source pixels, so warn before it costs print quality. */}
          {Math.round(frame.w / scale) < 1000 && (
            <span style={{ color: 'var(--amber)' }}>
              {' '}· zoomed in this far may print soft
            </span>
          )}
        </p>
      )}

      {error && <p className="name-help bad">{error}</p>}

      <div className="cropper-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Choose another</button>
        <button className="btn primary" onClick={apply} disabled={!natural || busy}>
          {busy ? 'Applying…' : 'Use this photo →'}
        </button>
      </div>
    </div>
  );
}
