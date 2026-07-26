import { scanText } from './text.js';
import { nameSeverityFor } from './terms.js';
import { fold } from './normalize.js';

// Cardholder name validation.
//
// Previously there was none: the input had maxLength=22 and the value went
// straight to .trim().toUpperCase() and into the ops queue. Anything typed there
// — profanity included — reached an embosser.

export const NAME_MAX = 22;
export const NAME_MIN = 2;

// Embossers render a restricted repertoire. Anything outside it is rejected
// here rather than becoming a mystery failure at the print stage.
const ALLOWED_CHAR = /^[A-Z .'\-]+$/;
const VOWELS = /[AEIOUY]/;

function reason(code, message, severity) {
  return { code, message, severity };
}

/**
 * Validate and normalize a cardholder name.
 *
 * @returns {{
 *   ok: boolean, severity: 'ok'|'review'|'block', normalized: string,
 *   reasons: Array<{code:string,message:string,severity:string}>,
 *   riskScore: number, scan: object, empty: boolean
 * }}
 */
export function validateCardholderName(raw) {
  const original = String(raw ?? '');
  // Uppercase, collapse whitespace, strip accents to their base letters so
  // "José" becomes the embossable "JOSE" instead of being rejected.
  const normalized = original
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

  const reasons = [];
  const empty = normalized.length === 0;

  if (empty) {
    return {
      ok: false, severity: 'review', normalized: '', empty: true, riskScore: 0,
      reasons: [reason('required', 'Please enter the name to print on the card.', 'review')],
      scan: null,
    };
  }

  // ── Structural checks ────────────────────────────────────────────────────
  if (normalized.length < NAME_MIN) {
    reasons.push(reason('too_short', 'That name looks too short — please enter the full name.', 'block'));
  }
  if (normalized.length > NAME_MAX) {
    reasons.push(reason('too_long', `Names can be at most ${NAME_MAX} characters to fit the card.`, 'block'));
  }
  if (!ALLOWED_CHAR.test(normalized)) {
    const offending = [...new Set(normalized.replace(/[A-Z .'\-]/g, '').split(''))].join(' ');
    reasons.push(reason(
      'charset',
      `Cards can only be embossed with letters, spaces, hyphens and apostrophes. Please remove: ${offending}`,
      'block',
    ));
  }
  if (!VOWELS.test(normalized)) {
    reasons.push(reason('no_vowel', 'That does not look like a name — please check the spelling.', 'review'));
  }
  if (/(.)\1{3,}/.test(normalized)) {
    reasons.push(reason('repeats', 'That does not look like a name — please check the spelling.', 'review'));
  }
  if (/^[ .'\-]|[ .'\-]$/.test(normalized)) {
    reasons.push(reason('edge_punctuation', 'Names cannot start or end with punctuation.', 'block'));
  }
  if (/[.'\- ]{2,}/.test(normalized)) {
    reasons.push(reason('double_punctuation', 'Please remove the repeated spaces or punctuation.', 'block'));
  }
  // Letters, ignoring separators — guards against "A-B-C" style filler.
  if (fold(normalized).replace(/[^a-z]/g, '').length < NAME_MIN) {
    reasons.push(reason('too_few_letters', 'Please enter the full name to print on the card.', 'block'));
  }

  // ── Content checks ───────────────────────────────────────────────────────
  // Name policy is narrower than prompt policy: profanity and slurs hard-block,
  // while a name that merely collides with a brand or public figure ("JESUS
  // CRUZ", "TESLA") goes to a human, because those are real legal names.
  const scan = scanText(normalized, nameSeverityFor);

  for (const cat of scan.categories) {
    const hit = scan.hits.find(h => h.category === cat);
    if (hit.severity === 'block') {
      reasons.push(reason(
        `content:${cat}`,
        'That name can’t be printed on a card. Please enter the name as it appears on your ID.',
        'block',
      ));
    } else {
      reasons.push(reason(
        `content:${cat}`,
        'We’ll need to check this name manually before printing.',
        'review',
      ));
    }
  }

  if (scan.obfuscationDetected) {
    reasons.push(reason(
      'obfuscation',
      'That name can’t be printed on a card. Please enter the name as it appears on your ID.',
      'block',
    ));
  }

  const severity = reasons.some(r => r.severity === 'block')
    ? 'block'
    : reasons.some(r => r.severity === 'review') ? 'review' : 'ok';

  // Structural problems are the customer's own typo, not a risk signal, so they
  // do not inflate the risk score — only content hits do.
  const structuralOnly = reasons.every(r => !r.code.startsWith('content:') && r.code !== 'obfuscation');
  const riskScore = structuralOnly ? 0 : Math.max(scan.riskScore, severity === 'block' ? 95 : 55);

  return {
    ok: severity === 'ok',
    severity,
    normalized,
    empty: false,
    riskScore,
    reasons,
    scan,
  };
}

/** First message worth showing the customer, or null when the name is fine. */
export function firstNameError(result) {
  if (!result || result.ok) return null;
  const blocking = result.reasons.find(r => r.severity === 'block');
  return (blocking || result.reasons[0])?.message ?? null;
}
