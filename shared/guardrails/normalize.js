// Text folding and blocklist matching.
//
// The old implementation matched /\bterm\b/i against raw input, so "guns",
// "n-u-d-e", "ironman" and "g u n" all scored 0. Two complementary matchers
// close those bypasses:
//
//   buildLooseMatcher(term)  matches the ORIGINAL string, tolerating leetspeak,
//                            accents, doubled letters and punctuation. Because
//                            it matches in place it yields offsets, which is
//                            what redaction needs.
//
//   termMatcher(term)        matches FOLDED text (see foldVariants), which also
//                            catches letters spaced apart ("g u n"). Folding
//                            destroys offsets, so hits found only here are
//                            detectable but not redactable — acceptable because
//                            every category that relies on it is a hard block,
//                            and a hard block never reaches a provider anyway.

// Combining marks, as an explicit escape — a literal range is invisible in
// source and easy to corrupt on copy/paste.
const COMBINING_MARKS = /[̀-ͯ]/g;

// Leetspeak / homoglyph folding, toward letters.
const LEET = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '2': 'z', '+': 't',
  '<': 'c', '(': 'c', '£': 'e', '€': 'e', '§': 's',
};

const LEET_RE = new RegExp(
  '[' + Object.keys(LEET).map(c => '\\' + c).join('') + ']',
  'g',
);

// Characters used to break a word up. Includes zero-width codepoints, a classic
// invisible-insertion bypass.
const SEP_CHARS = "\\s._\\-*+~/\\\\'\"`,;:!?()\\[\\]{}\\u200b\\u200c\\u200d\\ufeff";
// Short terms omit whitespace from their separator class, otherwise a 3-letter
// term like "ass" starts matching across word gaps ("a ss...") in ordinary text.
const SEP_CHARS_TIGHT = "._\\-*+~/\\\\'\"`\\u200b\\u200c\\u200d\\ufeff";

// Per-letter equivalence classes: digits, accents and symbols that render as
// the same glyph.
const LETTER_VARIANTS = {
  a: 'a4@àáâãäå', b: 'b8ß', c: 'c<(¢ç',
  d: 'd', e: 'e3£€èéêë', f: 'f', g: 'g9',
  h: 'h', i: 'i1!|ìíîï', j: 'j', k: 'k', l: 'l1|',
  m: 'm', n: 'nñ', o: 'o0°òóôõöø',
  p: 'p', q: 'q', r: 'r®', s: 's5$§', t: 't7+',
  u: 'uùúûüµ', v: 'v', w: 'w', x: 'x×',
  y: 'y¥ÿ', z: 'z2',
};

// Digits appearing literally in a term (ak47, ar15) should also match the
// letter they are commonly substituted for.
function charClass(ch) {
  let chars = LETTER_VARIANTS[ch];
  if (!chars) chars = LEET[ch] ? ch + LEET[ch] : ch;
  // Escape the few characters that are special inside a character class.
  const body = chars.replace(/[\]\\^-]/g, '\\$&');
  return '[' + body + ']';
}

// Suffixes tolerated after a matched term, so "gun" also catches "guns"/"gunz"
// and "drug" catches "drugs"/"drugged".
const SUFFIX = '(?:s|es|z|ed|ing|er|ers|y|ies)?';
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function stripAccentsAndCase(raw) {
  return String(raw ?? '').toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '');
}

function toWords(s) {
  return s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Canonical fold: lowercase, accents stripped, leetspeak folded,
 * non-alphanumerics reduced to single spaces.
 * "Nüde-Guns!" -> "nude guns"
 *
 * Repeated characters are deliberately NOT collapsed here. Collapsing them in
 * the fold is symmetric but destructive: it turned the term "kkk" into "k",
 * which then matched the standalone initial in "R K NARAYAN". Repetition is
 * handled in the matchers instead, via per-character `+` quantifiers.
 */
export function fold(raw) {
  return toWords(stripAccentsAndCase(raw).replace(LEET_RE, c => LEET[c] ?? c));
}

/**
 * Glue together letters that were deliberately spaced out, so "g u n" and
 * "n-u-d-e" become "gun" and "nude".
 *
 * Only runs of *single* characters joined by separators are collapsed. That
 * restriction is deliberate: a blanket remove-all-whitespace pass would turn
 * "from" into a match for a 2-letter term like "om".
 */
export function deIntersperse(raw) {
  let s = stripAccentsAndCase(raw).replace(LEET_RE, c => LEET[c] ?? c);
  // The leading \b matters: without it "with g u n" starts the run at the "h" of
  // "with" and yields "hgun" instead of "gun".
  const run = new RegExp(
    '\\b(?:[a-z0-9][' + SEP_CHARS + ']+){2,}[a-z0-9](?![a-z0-9])',
    'g',
  );
  s = s.replace(run, m => m.replace(new RegExp('[' + SEP_CHARS + ']+', 'g'), ''));
  return toWords(s);
}

/** The folded representations a term is tested against. */
export function foldVariants(raw) {
  const a = fold(raw);
  const b = deIntersperse(raw);
  return b === a ? [a] : [a, b];
}

/**
 * Matcher over FOLDED text. Folded text is only [a-z0-9 ], where `\b` is exact,
 * so no lookbehind is needed — lookbehind is a syntax error on iOS Safari
 * before 16.4 and would take down the entire bundle.
 */
export function termMatcher(term) {
  const folded = fold(term);
  if (!folded) return null;
  // Per-character `+` so "guuun" matches "gun" while "kkk" still requires three
  // k's — the property a collapse-in-the-fold approach cannot give us.
  const body = [...folded]
    .map(c => (c === ' ' ? '\\s*' : c.replace(ESCAPE_RE, '\\$&') + '+'))
    .join('');
  return new RegExp('\\b' + body + SUFFIX + '\\b', 'g');
}

/**
 * Matcher over the ORIGINAL string, tolerating obfuscation while preserving
 * offsets so matches can be redacted in place.
 */
export function buildLooseMatcher(term) {
  const letters = [...stripAccentsAndCase(term)].filter(c => /[a-z0-9]/.test(c));
  if (!letters.length) return null;
  // Terms shorter than 4 characters use the whitespace-free separator class.
  const sep = '[' + (letters.length < 4 ? SEP_CHARS_TIGHT : SEP_CHARS) + ']*';
  const body = letters.map(c => charClass(c) + '+').join(sep);
  return new RegExp('\\b' + body + SUFFIX + '\\b', 'gi');
}

/** True if `term` appears in any of the folded variants. */
export function matchesFolded(haystackVariants, term) {
  const re = termMatcher(term);
  if (!re) return false;
  return haystackVariants.some((h) => {
    re.lastIndex = 0;
    return re.test(h);
  });
}
