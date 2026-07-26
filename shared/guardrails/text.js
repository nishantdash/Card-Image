import { CATEGORIES } from './terms.js';
import { buildLooseMatcher, foldVariants, matchesFolded } from './normalize.js';

// Matchers are compiled once at module load — scanText runs on every keystroke
// in the name field, so rebuilding ~300 regexes per call is not acceptable.
const COMPILED = Object.entries(CATEGORIES).map(([key, cat]) => ({
  key,
  severity: cat.severity,
  weight: cat.weight,
  label: cat.label,
  terms: cat.terms
    .map(term => ({ term, loose: buildLooseMatcher(term) }))
    .filter(t => t.loose),
}));

// Creative substitutions, kept from the original REWRITE_MAP: for review-tier
// terms a flattering rewrite produces better artwork than a hole in the prompt.
const CREATIVE_REWRITES = [
  { match: /iron\s*-?\s*man/gi,              replace: 'a futuristic armored hero with a glowing chest reactor' },
  { match: /spider\s*-?\s*man/gi,            replace: 'an agile masked acrobat hero' },
  { match: /bat\s*-?\s*man/gi,               replace: 'a caped nocturnal vigilante silhouette' },
  { match: /super\s*-?\s*man/gi,             replace: 'a classic caped flying hero' },
  { match: /\b(hrithik|agneepath)\b/gi,      replace: 'a cinematic action hero portrait' },
  { match: /\b(virat|kohli|dhoni|sachin)\b/gi, replace: 'an athletic batsman silhouette' },
  { match: /\b(ronaldo|messi|neymar)\b/gi,   replace: 'a dynamic footballer silhouette' },
  { match: /\b(tom cruise|shahrukh|srk|brad pitt)\b/gi, replace: 'a cinematic leading-man portrait' },
  { match: /\b(nike|adidas|puma|reebok)\b/gi, replace: 'an athletic sportswear theme' },
  { match: /\b(marvel|disney|pixar|dc comics)\b/gi, replace: 'an epic comic-book aesthetic' },
  { match: /\b(ferrari|lamborghini|porsche)\b/gi, replace: 'a sleek supercar aesthetic' },
];

// Fallback replacement when a review-tier term has no creative rewrite. Hard
// block categories map to '' — the term is deleted outright.
const NEUTRAL_REPLACEMENT = {
  celebrities: 'an original fictional character',
  brands:      'an original unbranded motif',
  political:   'a neutral abstract motif',
  religious:   'a neutral abstract motif',
  weapons:     '',
  unsafe:      '',
  profanity:   '',
  slurs:       '',
};

/**
 * Scan text against every blocklist.
 *
 * @param raw          text to scan
 * @param severityFor  optional (category) => 'block'|'review', letting callers
 *                     apply a different policy than the category default.
 *                     Cardholder names use this — see terms.nameSeverityFor.
 */
export function scanText(raw, severityFor) {
  const text = String(raw ?? '');
  const hits = [];

  if (text.trim()) {
    const folded = foldVariants(text);

    for (const cat of COMPILED) {
      const severity = severityFor ? severityFor(cat.key) : cat.severity;
      for (const { term, loose } of cat.terms) {
        loose.lastIndex = 0;
        const inPlace = loose.test(text);
        // Only pay for the folded check when the cheap in-place one missed.
        const viaFold = inPlace ? false : matchesFolded(folded, term);
        if (!inPlace && !viaFold) continue;
        hits.push({
          category: cat.key,
          label: cat.label,
          term,
          severity,
          weight: cat.weight,
          // A fold-only hit cannot be located in the original string, so it
          // cannot be surgically redacted.
          redactable: inPlace,
          obfuscated: viaFold,
        });
      }
    }
  }

  const categories = [...new Set(hits.map(h => h.category))];
  const blocking = hits.filter(h => h.severity === 'block');

  // Score = heaviest category hit, plus a small escalation for breadth. The old
  // formula summed per-category constants, which made the score depend on how
  // many synonyms a user happened to type rather than on how bad the worst hit
  // was.
  let riskScore = 0;
  if (hits.length) {
    const heaviest = Math.max(...hits.map(h => h.weight));
    riskScore = Math.min(100, heaviest + (categories.length - 1) * 5);
  }

  return {
    hits,
    categories,
    riskScore,
    hardBlocked: blocking.length > 0,
    blockedCategories: [...new Set(blocking.map(h => h.category))],
    // True when a hit was only visible after de-obfuscation — itself a signal
    // that someone is probing the filter.
    obfuscationDetected: hits.some(h => h.obfuscated),
    flags: categories.map(c => `${c}:${hits.filter(h => h.category === c).length}`),
  };
}

/**
 * Remove or rewrite every blocklist hit so the text is safe to forward to an
 * image provider.
 *
 * The previous implementation only rewrote 6 patterns, so terms like "gun",
 * "cocaine" and "nude" scored 100 and were still sent verbatim. Here every
 * matched term is dealt with.
 */
export function redactText(raw, severityFor) {
  let text = String(raw ?? '');
  if (!text.trim()) return { text, redactions: [], residual: [] };

  const redactions = [];

  // Creative rewrites first — they read better than a neutral placeholder.
  for (const { match, replace } of CREATIVE_REWRITES) {
    const re = new RegExp(match.source, match.flags);
    if (re.test(text)) {
      text = text.replace(new RegExp(match.source, match.flags), replace);
      redactions.push({ term: match.source, kind: 'rewrite' });
    }
  }

  // Then sweep anything the blocklists still match.
  const residual = [];
  for (const cat of COMPILED) {
    const severity = severityFor ? severityFor(cat.key) : cat.severity;
    for (const { term, loose } of cat.terms) {
      loose.lastIndex = 0;
      if (!loose.test(text)) continue;
      const replacement = NEUTRAL_REPLACEMENT[cat.key] ?? '';
      loose.lastIndex = 0;
      text = text.replace(loose, replacement);
      redactions.push({ term, category: cat.key, severity, kind: replacement ? 'neutralized' : 'removed' });
    }
  }

  // Anything detectable only after de-obfuscation cannot be redacted in place.
  // Report it so the caller refuses to generate rather than forwarding text it
  // could not clean.
  const after = scanText(text, severityFor);
  for (const h of after.hits) {
    if (!h.redactable) residual.push(h);
  }

  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return { text, redactions, residual, clean: residual.length === 0 };
}

/**
 * Backwards-compatible wrapper matching the old sanitize.js signature, so
 * existing call sites keep working.
 */
export function sanitizePrompt(raw) {
  const scan = scanText(raw);
  const { text } = redactText(raw);
  return {
    sanitized: text,
    riskScore: scan.riskScore,
    flagsHit: scan.categories,
    hardBlocked: scan.hardBlocked,
    hits: scan.hits,
  };
}
