// Run with: node --test shared/cardGeometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_ASPECT, CARD_MM, CARD_PX, cardAspect, cardTarget, coverCrop, providerAspects,
} from './cardGeometry.js';

const ratio = (s) => {
  const [a, b] = s.split(':').map(Number);
  return a / b;
};

test('card aspect matches ISO/IEC 7810 ID-1', () => {
  // 85.6 x 53.98 mm -> ~1.586:1, simplified 8:5.
  assert.equal(CARD_MM.width, 85.6);
  assert.ok(Math.abs(CARD_ASPECT - 1.586) < 0.001, `got ${CARD_ASPECT}`);
  // The print target must agree with the physical ratio.
  assert.ok(Math.abs(CARD_PX.width / CARD_PX.height - CARD_ASPECT) < 0.002);
});

test('orientation inverts the aspect', () => {
  assert.ok(Math.abs(cardAspect('horizontal') * cardAspect('vertical') - 1) < 1e-9);
  assert.deepEqual(cardTarget('vertical'), { width: CARD_PX.height, height: CARD_PX.width });
});

test('the preferred provider ratio is the closest available to the card', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const want = cardAspect(orientation);
    const list = providerAspects(orientation);
    const errors = list.map(a => Math.abs(ratio(a) - want));
    // First entry must be the best of the list.
    assert.equal(
      Math.min(...errors), errors[0],
      `${orientation}: ${list[0]} is not the closest of ${list.join(', ')}`,
    );
    // And it must be a genuinely tight match, unlike the old 16:9.
    assert.ok(errors[0] < 0.02, `${orientation}: ${list[0]} off by ${errors[0].toFixed(3)}`);
  }
});

test('16:9 would have been a poor choice — the bug being fixed', () => {
  const off = Math.abs(16 / 9 - CARD_ASPECT);
  assert.ok(off > 0.15, 'sanity: 16:9 really is far from the card ratio');
  // ~11% of the width was being thrown away.
  const wasted = 1 - CARD_ASPECT / (16 / 9);
  assert.ok(wasted > 0.1, `wasted ${(wasted * 100).toFixed(1)}%`);
});

// ── coverCrop ──────────────────────────────────────────────────────────────
test('a 16:9 source is trimmed on the sides, not the top', () => {
  const c = coverCrop(1920, 1080, 'horizontal');
  assert.equal(c.sh, 1080, 'full height retained');
  assert.ok(c.sw < 1920, 'width trimmed');
  assert.ok(c.sx > 0 && c.sy === 0);
  assert.ok(Math.abs(c.sw / c.sh - CARD_ASPECT) < 0.01);
});

test('a tall source is trimmed top and bottom', () => {
  const c = coverCrop(1000, 1500, 'horizontal');
  assert.equal(c.sw, 1000, 'full width retained');
  assert.ok(c.sh < 1500);
  assert.ok(c.sy > 0 && c.sx === 0);
});

test('output is exactly the card aspect for both orientations', () => {
  for (const [w, h, orientation] of [
    [1920, 1080, 'horizontal'], [1080, 1920, 'vertical'],
    [2048, 1152, 'horizontal'], [800, 800, 'horizontal'], [800, 800, 'vertical'],
  ]) {
    const c = coverCrop(w, h, orientation);
    const got = c.width / c.height;
    const want = cardAspect(orientation);
    assert.ok(Math.abs(got - want) < 0.01, `${w}x${h} ${orientation}: got ${got.toFixed(3)} want ${want.toFixed(3)}`);
  }
});

test('an exact-ratio source is left alone', () => {
  const c = coverCrop(CARD_PX.width, CARD_PX.height, 'horizontal');
  assert.equal(c.sx, 0);
  assert.equal(c.sy, 0);
  assert.equal(c.sw, CARD_PX.width);
});

test('never upscales past the print target', () => {
  // A huge source is capped, not blown up further.
  const c = coverCrop(8000, 5000, 'horizontal');
  assert.ok(c.width <= CARD_PX.width, `width ${c.width}`);
});

test('a small source keeps its own resolution rather than being inflated', () => {
  // Manufacturing pixels here would hide the shortfall from the DPI check.
  const c = coverCrop(600, 400, 'horizontal');
  assert.ok(c.width <= 600, `width ${c.width} should not exceed the source`);
});

test('crop rect always sits inside the source', () => {
  for (const [w, h] of [[1920, 1080], [640, 480], [1000, 3000], [3000, 1000]]) {
    for (const orientation of ['horizontal', 'vertical']) {
      const c = coverCrop(w, h, orientation);
      assert.ok(c.sx >= 0 && c.sy >= 0, `${w}x${h} ${orientation}: negative offset`);
      assert.ok(c.sx + c.sw <= w + 1, `${w}x${h} ${orientation}: overruns width`);
      assert.ok(c.sy + c.sh <= h + 1, `${w}x${h} ${orientation}: overruns height`);
    }
  }
});
