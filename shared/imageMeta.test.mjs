// Run with: node --test shared/imageMeta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { imageDimensions, assessEmbosserFit, EMBOSSER_MIN } from './imageMeta.js';
import { applyImageQuality, unavailableImageQuality, IMAGE_QUALITY } from './guardrails/modelPolicy.js';

// ── Synthetic headers ──────────────────────────────────────────────────────
// Only the header is parsed, so a valid header plus padding is a sufficient
// fixture and avoids checking binary blobs into the repo.
function pngB64(width, height) {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString('base64');
}

function jpegB64(width, height) {
  const buf = Buffer.alloc(64);
  let i = 0;
  buf[i++] = 0xff; buf[i++] = 0xd8;            // SOI
  buf[i++] = 0xff; buf[i++] = 0xc0;            // SOF0
  buf[i++] = 0x00; buf[i++] = 0x11;            // segment length (17)
  buf[i++] = 0x08;                             // precision
  buf.writeUInt16BE(height, i); i += 2;
  buf.writeUInt16BE(width, i); i += 2;
  return buf.toString('base64');
}

// ── Dimension parsing ──────────────────────────────────────────────────────
test('reads PNG dimensions', () => {
  assert.deepEqual(imageDimensions(pngB64(2048, 1152)), { width: 2048, height: 1152, format: 'png' });
});

test('reads JPEG dimensions', () => {
  assert.deepEqual(imageDimensions(jpegB64(1024, 768)), { width: 1024, height: 768, format: 'jpeg' });
});

test('accepts a data URL as well as raw base64', () => {
  const d = imageDimensions(`data:image/png;base64,${pngB64(800, 600)}`);
  assert.equal(d.width, 800);
  assert.equal(d.height, 600);
});

test('unreadable input returns null rather than throwing', () => {
  for (const bad of [null, undefined, '', 'not-base64!!', 'data:image/png;base64,', 'AAAA']) {
    assert.equal(imageDimensions(bad), null, String(bad));
  }
});

// ── Embosser fit ───────────────────────────────────────────────────────────
test('a 2K render clears the embosser minimum', () => {
  // 2048x1152 exceeds 1713x1080 on both edges.
  const fit = assessEmbosserFit(pngB64(2048, 1152));
  assert.equal(fit.measured, true);
  assert.equal(fit.meetsEmbosserMinimum, true);
  assert.ok(fit.upscaleFactor <= 1);
  assert.equal(fit.effectiveDpi, EMBOSSER_MIN.dpi);
});

test('a default-size render is flagged as needing upscaling', () => {
  // A common default 16:9 output, well under card resolution.
  const fit = assessEmbosserFit(pngB64(1344, 768));
  assert.equal(fit.meetsEmbosserMinimum, false);
  assert.ok(fit.upscaleFactor > 1, `factor ${fit.upscaleFactor}`);
  assert.ok(fit.effectiveDpi < EMBOSSER_MIN.dpi);
  assert.match(fit.note, /below the embosser minimum/i);
});

test('orientation does not affect the verdict', () => {
  const landscape = assessEmbosserFit(pngB64(2048, 1152));
  const portrait = assessEmbosserFit(pngB64(1152, 2048));
  assert.equal(landscape.meetsEmbosserMinimum, portrait.meetsEmbosserMinimum);
});

test('unmeasurable input is reported, not assumed fine', () => {
  const fit = assessEmbosserFit('garbage');
  assert.equal(fit.measured, false);
  assert.equal(fit.meetsEmbosserMinimum, false, 'must not default to passing');
});

// ── Prompt fidelity / quality policy ───────────────────────────────────────
const quality = (q) => applyImageQuality({ quality: q });

test('a faithful high-quality render passes everything', () => {
  const r = quality({ prompt_match: 90, visual_quality: 85, text_free: 100, emboss_safe: 80 });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.embosserReady, true);
  assert.ok(r.overall >= 85, `overall ${r.overall}`);
});

test('a beautiful image of the wrong thing scores poorly', () => {
  // Fidelity is weighted heaviest on purpose.
  const r = quality({ prompt_match: 10, visual_quality: 95, text_free: 100, emboss_safe: 95 });
  assert.ok(r.failures.includes('prompt_match'));
  assert.ok(r.overall < 65, `overall ${r.overall}`);
});

test('rendered text is flagged', () => {
  const r = quality({ prompt_match: 80, visual_quality: 80, text_free: 20, emboss_safe: 80 });
  assert.ok(r.failures.includes('text_free'));
  assert.equal(r.embosserReady, false);
});

test('busy detail under the emboss zones is flagged', () => {
  const r = quality({ prompt_match: 80, visual_quality: 80, text_free: 100, emboss_safe: 20 });
  assert.ok(r.failures.includes('emboss_safe'));
  assert.equal(r.embosserReady, false);
});

test('borderline scores warn rather than fail', () => {
  const r = quality({ prompt_match: 55, visual_quality: 55, text_free: 65, emboss_safe: 55 });
  assert.deepEqual(r.failures, []);
  assert.ok(r.warnings.length > 0);
});

test('every quality key has a fail threshold below its warn threshold', () => {
  for (const [key, l] of Object.entries(IMAGE_QUALITY)) {
    assert.ok(l.fail < l.warn, `${key}: fail ${l.fail} should be below warn ${l.warn}`);
  }
});

test('missing-elements note is captured and bounded', () => {
  const r = applyImageQuality({
    quality: { prompt_match: 40, visual_quality: 70, text_free: 100, emboss_safe: 70 },
    missing: 'no mountains in the background',
  });
  assert.equal(r.missing, 'no mountains in the background');
  const long = applyImageQuality({ quality: {}, missing: 'x'.repeat(600) });
  assert.ok(long.missing.length <= 240);
});

test('absent scores do not silently read as perfect', () => {
  const r = quality({});
  assert.equal(r.overall, 0);
  assert.ok(r.failures.length > 0, 'zeros must fail, not pass');
});

test('an unavailable assessment is explicit', () => {
  const r = unavailableImageQuality();
  assert.equal(r.available, false);
  assert.equal(r.overall, null);
  assert.equal(r.embosserReady, null);
});
