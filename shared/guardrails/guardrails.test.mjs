// Run with: node --test shared/guardrails/
import test from 'node:test';
import assert from 'node:assert/strict';

import { scanText, redactText } from './text.js';
import { validateCardholderName } from './name.js';
import { scoreSubmission, THRESHOLDS } from './score.js';
import { evaluateSubmission } from './index.js';

const NO_DETECTORS = {
  nsfw:      { available: false, value: null },
  celebrity: { available: false, value: null },
  logo:      { available: false, value: null },
  ocrText:   { available: false, value: null },
};

// Stand-in for detectors being wired up and returning clean results.
const CLEAN_DETECTORS = {
  nsfw:         { available: true, value: 2 },
  celebrity:    { available: true, value: 3 },
  logo:         { available: true, value: 0 },
  ocrText:      { available: true, value: 0 },
  imageQuality: { available: true, value: 5 },
};

// ── Finding #1: cardholder name validation ─────────────────────────────────
test('the reported bypass is blocked', () => {
  const r = validateCardholderName('Motherfucker');
  assert.equal(r.severity, 'block');
  assert.equal(r.ok, false);
});

test('profanity survives obfuscation attempts in names', () => {
  for (const variant of [
    'MOTHERFUCKER', 'motherfucker', 'M0TH3RFUCK3R', 'mother fucker',
    'MOTHERFUCKERS', 'm-o-t-h-e-r-f-u-c-k-e-r', 'Motherfuuuucker',
    'FUCK', 'F.U.C.K', 'sh1t', 'B!TCH', 'a$$hole', 'CUNT',
  ]) {
    const r = validateCardholderName(variant);
    assert.equal(r.severity, 'block', `expected block for ${variant}`);
  }
});

test('slurs are blocked in names', () => {
  for (const v of ['NIGGER', 'n1gga', 'FAGGOT', 'HITLER']) {
    assert.equal(validateCardholderName(v).severity, 'block', v);
  }
});

test('legitimate names pass cleanly', () => {
  for (const v of [
    'AMIT SHARMA', 'PRIYA NAIR', "JOSE O'BRIEN", 'MARY-JANE WATSON',
    'JOSÉ GARCÍA', 'R K NARAYAN', 'ANNE MARIE ST CLAIR',
  ]) {
    const r = validateCardholderName(v);
    assert.equal(r.severity, 'ok', `${v} -> ${JSON.stringify(r.reasons)}`);
  }
});

test('real names that collide with public figures go to review, not block', () => {
  // Plenty of people are legally named Jesus, Cruz or Tesla.
  for (const v of ['JESUS CRUZ', 'TESLA MEHTA', 'MODI PATEL']) {
    const r = validateCardholderName(v);
    assert.equal(r.severity, 'review', `${v} should be reviewable, not blocked`);
  }
});

test('non-embossable characters are rejected', () => {
  for (const v of ['N1SHANT', 'AMIT 😀', 'AMIT#SHARMA', '田中太郎']) {
    const r = validateCardholderName(v);
    assert.equal(r.severity, 'block', v);
    assert.ok(r.reasons.some(x => x.code === 'charset'), `${v} should flag charset`);
  }
});

test('structural junk is rejected without inflating risk', () => {
  const r = validateCardholderName('AAAAAAA');
  assert.notEqual(r.severity, 'ok');
  assert.equal(r.riskScore, 0, 'a typo is not a compliance risk');
});

test('accents normalize to embossable letters', () => {
  assert.equal(validateCardholderName('José García').normalized, 'JOSE GARCIA');
});

test('empty name is required but not risky', () => {
  const r = validateCardholderName('   ');
  assert.equal(r.empty, true);
  assert.equal(r.riskScore, 0);
});

// ── Finding #3: blocklist variant bypass ───────────────────────────────────
test('plurals and obfuscation no longer bypass the blocklist', () => {
  for (const v of [
    'guns', 'knives', 'nudes', 'drugs', 'bombs', 'ironman',
    'g u n', 'n-u-d-e', 'naked_woman', 'GUUUNS', 'c0ca1ne', 'n@ked',
  ]) {
    const s = scanText(`card art with ${v}`);
    assert.ok(s.riskScore > 0, `${v} should be detected`);
  }
});

test('a single-letter word before a spaced-out term does not hide it', () => {
  // Regression: "a g u n" glued to "agun", where \bgun\b could no longer match,
  // so the term slipped through. Only affected short terms, which use a
  // whitespace-free separator class in the loose matcher and therefore depend on
  // the folded variant.
  for (const v of [
    'a g u n on the card', 'a b o m b', 'a s e x scene', 'the a s s design',
    'I n u d e photo', 'a g u n s pair', 'x k k k banner', 'a p e d o image',
  ]) {
    assert.ok(scanText(v).riskScore > 0, `${v} should be detected`);
  }
});

test('spaced initials and abbreviations stay clean', () => {
  // The fix must not turn every spaced-letter sequence into a hit.
  for (const v of [
    'R K NARAYAN', 'a b c d e initials', 'a s a p delivery', 'I am a big fan',
    'J R R Tolkien style', 'a e i o u',
  ]) {
    assert.equal(scanText(v).riskScore, 0, `${v} -> ${JSON.stringify(scanText(v).categories)}`);
  }
});

test('ordinary words are not false positives', () => {
  for (const v of [
    'a classy minimal design', 'begun at sunrise', 'brass bass guitar',
    'the assembly of glass', 'a compass across the shore', 'from my mom',
    'sunset over a bridge', 'watercolour flowers', 'a shoe and a book',
  ]) {
    const s = scanText(v);
    assert.equal(s.riskScore, 0, `${v} -> ${JSON.stringify(s.categories)}`);
  }
});

// ── Finding #5: prompt redaction ───────────────────────────────────────────
test('every blocklist hit is removed from the outgoing prompt', () => {
  const raw = 'nude bloody gore photo of Virat Kohli holding a gun and a bomb, Nike Marvel Trump Jesus cocaine';
  const { text } = redactText(raw);
  for (const leaked of ['nude', 'gore', 'gun', 'bomb', 'cocaine', 'trump', 'jesus', 'kohli']) {
    assert.ok(!text.toLowerCase().includes(leaked), `"${leaked}" leaked through: ${text}`);
  }
});

test('redacted prompt scans clean afterwards', () => {
  const { text } = redactText('a gun-toting Iron Man with nike shoes and cocaine');
  assert.equal(scanText(text).riskScore, 0, `residual risk in: ${text}`);
});

test('benign prompt text is left intact', () => {
  const raw = 'a calm watercolour sunset over the mountains';
  assert.equal(redactText(raw).text, raw);
});

// ── Finding #2: REJECTED must be reachable ─────────────────────────────────
test('hard-block categories force REJECTED', () => {
  const prompt = scanText('a gun and cocaine');
  const name = validateCardholderName('AMIT SHARMA');
  const r = scoreSubmission({ prompt, name, detectors: CLEAN_DETECTORS });
  assert.equal(r.decision.code, 'REJECTED');
  assert.ok(r.riskScore >= THRESHOLDS.manual);
});

test('a blocked name alone forces REJECTED', () => {
  const r = scoreSubmission({
    prompt: scanText('a nice watercolour sunset'),
    name: validateCardholderName('MOTHERFUCKER'),
    detectors: CLEAN_DETECTORS,
  });
  assert.equal(r.decision.code, 'REJECTED');
});

test('the full decision range is reachable', () => {
  const reached = new Set();
  const cases = [
    ['a calm watercolour sunset', 'AMIT SHARMA', CLEAN_DETECTORS],
    ['a calm sunset', 'AMIT SHARMA', { ...CLEAN_DETECTORS, nsfw: { available: true, value: 55 } }],
    ['an iron man themed card', 'AMIT SHARMA', CLEAN_DETECTORS],
    ['a gun', 'AMIT SHARMA', CLEAN_DETECTORS],
  ];
  for (const [text, nm, det] of cases) {
    reached.add(scoreSubmission({
      prompt: scanText(text), name: validateCardholderName(nm), detectors: det,
    }).decision.code);
  }
  for (const code of ['AUTO_APPROVE', 'MANUAL_REVIEW', 'REJECTED']) {
    assert.ok(reached.has(code), `${code} unreachable; reached ${[...reached].join(',')}`);
  }
});

// ── Finding #6: unevaluated detectors must not auto-approve ────────────────
test('missing detectors prevent auto-approval', () => {
  const r = scoreSubmission({
    prompt: scanText('a calm watercolour sunset'),
    name: validateCardholderName('AMIT SHARMA'),
    detectors: NO_DETECTORS,
  });
  assert.notEqual(r.decision.code, 'AUTO_APPROVE');
  assert.ok(r.unevaluated.length > 0);
  assert.ok(r.coverage < 100);
});

test('an uninspected customer photo requires a human', () => {
  const r = scoreSubmission({
    prompt: scanText('stylize my photo'),
    name: validateCardholderName('AMIT SHARMA'),
    detectors: NO_DETECTORS,
    hasUpload: true,
  });
  assert.equal(r.decision.code, 'MANUAL_REVIEW');
});

test('clean detectors allow auto-approval', () => {
  const r = scoreSubmission({
    prompt: scanText('a calm watercolour sunset'),
    name: validateCardholderName('AMIT SHARMA'),
    detectors: CLEAN_DETECTORS,
  });
  assert.equal(r.decision.code, 'AUTO_APPROVE');
  assert.equal(r.coverage, 100);
});

// ── End-to-end ─────────────────────────────────────────────────────────────
test('evaluateSubmission refuses generation on hard block', () => {
  const r = evaluateSubmission({
    freeText: 'iron man holding a gun',
    cardholderName: 'AMIT SHARMA',
    detectors: CLEAN_DETECTORS,
  });
  assert.equal(r.allowGeneration, false);
  assert.equal(r.decision.code, 'REJECTED');
});

test('evaluateSubmission allows a clean submission and exposes safe text', () => {
  const r = evaluateSubmission({
    freeText: 'a calm mountain sunset',
    styleText: 'watercolor style, serene mood',
    cardholderName: 'PRIYA NAIR',
    detectors: CLEAN_DETECTORS,
  });
  assert.equal(r.allowGeneration, true);
  assert.equal(r.decision.code, 'AUTO_APPROVE');
  assert.equal(r.safeFreeText, 'a calm mountain sunset');
});

test('review-tier terms are rewritten and still generate', () => {
  const r = evaluateSubmission({
    freeText: 'an iron man style card',
    cardholderName: 'PRIYA NAIR',
    detectors: CLEAN_DETECTORS,
  });
  assert.equal(r.allowGeneration, true);
  assert.ok(!/iron\s*man/i.test(r.safeFreeText), r.safeFreeText);
  assert.equal(r.decision.code, 'MANUAL_REVIEW');
});
