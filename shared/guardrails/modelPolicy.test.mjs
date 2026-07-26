// Run with: node --test shared/guardrails/modelPolicy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyModelVerdict, unavailableModelVerdict, mergeModelVerdicts, MODEL_CATEGORIES,
} from './modelPolicy.js';
import { evaluateSubmission } from './index.js';
import { scanText } from './text.js';

const verdict = (categories, reasoning = '') => applyModelVerdict({ categories, reasoning });
const CLEAN_MODEL = verdict({});

// ── Threshold policy ───────────────────────────────────────────────────────
test('a clean verdict blocks nothing', () => {
  const v = CLEAN_MODEL;
  assert.deepEqual(v.blocked, []);
  assert.deepEqual(v.review, []);
  assert.equal(v.riskScore, 0);
  assert.equal(v.available, true);
});

test('sexual_minors has near-zero tolerance', () => {
  assert.ok(MODEL_CATEGORIES.sexual_minors.block <= 10);
  assert.deepEqual(verdict({ sexual_minors: 10 }).blocked, ['sexual_minors']);
  // Even a low score routes to review rather than passing silently.
  assert.ok(verdict({ sexual_minors: 6 }).review.includes('sexual_minors'));
});

test('each category blocks at its own threshold', () => {
  for (const [key, limits] of Object.entries(MODEL_CATEGORIES)) {
    if (limits.block == null) continue;
    const v = verdict({ [key]: limits.block });
    assert.ok(v.blocked.includes(key), `${key} should block at ${limits.block}`);
    assert.ok(v.riskScore >= 95, `${key} block should drive risk high`);
  }
});

test('a single severe category is not averaged away', () => {
  // 15 categories at zero, one at block level — the average would be ~6.
  const v = verdict({ sexual: 90 });
  assert.ok(v.blocked.includes('sexual'));
  assert.ok(v.riskScore >= 95, `got ${v.riskScore}`);
});

test('trademark scores high enough to review but not to block', () => {
  const v = verdict({ trademark_brand: 50 });
  assert.deepEqual(v.blocked, []);
  assert.ok(v.review.includes('trademark_brand'));
});

test('detector slots are populated from category scores', () => {
  const v = verdict({ sexual: 30, gore: 70, celebrity_likeness: 45, trademark_brand: 12, text_in_image: 60 });
  assert.equal(v.detectors.nsfw.value, 70, 'nsfw takes the worst of sexual/minors/gore');
  assert.equal(v.detectors.celebrity.value, 45);
  assert.equal(v.detectors.logo.value, 12);
  assert.equal(v.detectors.ocrText.value, 60);
  for (const d of Object.values(v.detectors)) assert.equal(d.available, true);
});

// ── Merging ────────────────────────────────────────────────────────────────
test('merging takes the worst score per category', () => {
  const merged = mergeModelVerdicts([
    verdict({ sexual: 10, violence: 70 }),
    verdict({ sexual: 65, violence: 5 }),
  ]);
  assert.equal(merged.scores.sexual, 65);
  assert.equal(merged.scores.violence, 70);
  assert.ok(merged.blocked.includes('sexual'));
});

test('a partial outage marks the merge unavailable but keeps real detections', () => {
  const merged = mergeModelVerdicts([
    verdict({ sexual: 90 }),
    unavailableModelVerdict('timeout'),
  ]);
  assert.equal(merged.available, false, 'incomplete coverage must be reported');
  assert.ok(merged.blocked.includes('sexual'), 'a real detection must survive the outage');
  for (const d of Object.values(merged.detectors)) assert.equal(d.available, false);
});

// ── Integration: model catches what the blocklist cannot ───────────────────
test('paraphrase that defeats the blocklist is caught by the model', () => {
  const phrase = 'a beautiful lady wearing absolutely nothing at all, full body';

  // The keyword list genuinely misses this — no listed term appears.
  assert.equal(scanText(phrase).riskScore, 0, 'precondition: blocklist misses paraphrase');

  const withModel = evaluateSubmission({
    freeText: phrase,
    cardholderName: 'PRIYA NAIR',
    model: verdict({ sexual: 85 }, 'describes full nudity'),
  });
  assert.equal(withModel.allowGeneration, false);
  assert.equal(withModel.decision.code, 'REJECTED');
});

test('the blocklist still blocks when the model reports clean', () => {
  // Neither detector can veto the other.
  const r = evaluateSubmission({
    freeText: 'a gun and some cocaine',
    cardholderName: 'PRIYA NAIR',
    model: CLEAN_MODEL,
  });
  assert.equal(r.allowGeneration, false);
  assert.equal(r.decision.code, 'REJECTED');
});

test('a model block on the cardholder name blocks the name', () => {
  const r = evaluateSubmission({
    freeText: 'a calm sunset',
    cardholderName: 'ZXQVBN PLOK',
    model: CLEAN_MODEL,
    nameModel: verdict({ hate: 90 }, 'transliterated slur'),
  });
  assert.equal(r.name.severity, 'block');
  assert.equal(r.allowGeneration, false);
});

test('a model review on the name routes to a human', () => {
  const r = evaluateSubmission({
    freeText: 'a calm sunset',
    cardholderName: 'SOME NAME',
    model: CLEAN_MODEL,
    nameModel: verdict({ pii: 40 }),
  });
  assert.equal(r.name.severity, 'review');
  assert.equal(r.decision.code, 'MANUAL_REVIEW');
});

// ── Fail-closed, not fail-reject ───────────────────────────────────────────
test('a moderation outage does not auto-approve', () => {
  const r = evaluateSubmission({
    freeText: 'a calm mountain sunset',
    cardholderName: 'PRIYA NAIR',
    model: unavailableModelVerdict('provider timeout'),
  });
  assert.notEqual(r.decision.code, 'AUTO_APPROVE');
  assert.ok(r.unevaluated.length > 0);
});

test('a moderation outage does not falsely reject the customer', () => {
  const r = evaluateSubmission({
    freeText: 'a calm mountain sunset',
    cardholderName: 'PRIYA NAIR',
    model: unavailableModelVerdict('provider timeout'),
  });
  assert.equal(r.allowGeneration, true, 'an outage is not the customer\'s fault');
  assert.notEqual(r.decision.code, 'REJECTED');
});

test('a working model allows a clean design to auto-approve', () => {
  const r = evaluateSubmission({
    freeText: 'a calm mountain sunset',
    styleText: 'watercolor style, calm mood',
    cardholderName: 'PRIYA NAIR',
    model: CLEAN_MODEL,
    detectors: { imageQuality: { available: true, value: 5 } },
  });
  assert.equal(r.decision.code, 'AUTO_APPROVE');
  assert.equal(r.coverage, 100, 'model fills every detector slot');
});
