// Blocklists, grouped by how a hit should be treated.
//
// `severity` drives policy, not just a number:
//   'block'  -> hard block. Overrides the weighted score entirely (L3).
//   'review' -> cannot auto-approve; routed to a human.
//
// In production these lists belong in a maintained data source (or a moderation
// vendor) rather than a source file — they are locale-specific, they go stale,
// and shipping them in the client bundle tells an attacker exactly what to
// avoid. That is why the authoritative copy of this evaluation now runs
// server-side; see api/generate.js.

export const CATEGORIES = {
  // ── Hard blocks ──────────────────────────────────────────────────────────
  profanity: {
    severity: 'block',
    weight: 100,
    label: 'Profanity',
    terms: [
      'fuck', 'motherfucker', 'fucker', 'fuckface', 'clusterfuck',
      'shit', 'bullshit', 'shithead', 'dipshit',
      'cunt', 'bitch', 'bastard', 'asshole', 'arsehole', 'ass', 'arse',
      'dick', 'dickhead', 'cock', 'prick', 'twat', 'wanker', 'tosser',
      'pussy', 'slut', 'whore', 'skank',
      'bollocks', 'bugger', 'crap', 'douche', 'douchebag',
      'jackass', 'dumbass', 'smartass', 'badass',
      'piss', 'pissed', 'turd', 'wank', 'jerkoff', 'blowjob',
      'penis', 'vagina', 'boobs', 'tits', 'titties', 'scrotum', 'testicle',
      'bhosda', 'bhosdike', 'madarchod', 'behenchod', 'chutiya', 'gandu',
      'randi', 'lauda', 'harami', 'kutta', 'kamina',
    ],
  },
  slurs: {
    severity: 'block',
    weight: 100,
    label: 'Hate speech / slur',
    terms: [
      'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'tranny',
      'chink', 'gook', 'spic', 'wetback', 'kike', 'raghead',
      'towelhead', 'paki', 'coon', 'retard', 'retarded',
      'mongoloid', 'cripple', 'midget',
      'nazi', 'hitler', 'kkk', 'whitepower', 'heilhitler',
      'jihad', 'isis', 'alqaeda', 'terrorist',
    ],
  },
  weapons: {
    severity: 'block',
    weight: 85,
    label: 'Weapons / violence',
    terms: [
      'gun', 'handgun', 'shotgun', 'rifle', 'pistol', 'revolver', 'firearm',
      'ak47', 'ar15', 'uzi', 'glock',
      // Irregular plurals need their own entries — the suffix tolerance in
      // normalize.js covers "-s"/"-es"/"-ing", not f->ves.
      'knife', 'knives', 'dagger', 'machete', 'sword', 'blade',
      'bomb', 'grenade', 'explosive', 'landmine', 'missile', 'warhead',
      'bullet', 'ammo', 'ammunition', 'silencer',
      'behead', 'beheading', 'lynch', 'murder', 'massacre', 'genocide',
    ],
  },
  unsafe: {
    severity: 'block',
    weight: 95,
    label: 'Adult / graphic / illegal',
    terms: [
      'nude', 'nudity', 'naked', 'topless', 'sexual', 'sex', 'porn',
      'porno', 'pornography', 'hentai', 'erotic', 'orgasm', 'fetish',
      'bdsm', 'incest', 'rape', 'molest', 'pedophile', 'pedo', 'csam',
      'lolita', 'underage', 'childporn',
      'blood', 'bloody', 'gore', 'gory', 'mutilate', 'dismember', 'corpse',
      'suicide', 'selfharm', 'cutting',
      'drug', 'cocaine', 'heroin', 'meth', 'methamphetamine', 'crack',
      'weed', 'marijuana', 'cannabis', 'lsd', 'ecstasy', 'mdma', 'opioid',
      'fentanyl', 'ketamine',
    ],
  },

  // ── Review-only ──────────────────────────────────────────────────────────
  // These are legitimate for a *person's name* (plenty of people are named
  // Jesus, Modi or Cruz) but not for generated card artwork, so they route to a
  // human instead of hard-blocking. Name policy differs from prompt policy;
  // see nameSeverityFor() below.
  celebrities: {
    severity: 'review',
    weight: 55,
    label: 'Celebrity likeness',
    terms: [
      'iron man', 'ironman', 'spiderman', 'batman', 'superman',
      'hrithik', 'agneepath', 'virat', 'kohli', 'dhoni', 'sachin',
      'ronaldo', 'messi', 'neymar', 'lebron',
      'shahrukh', 'srk', 'salman khan', 'amitabh', 'deepika',
      'tom cruise', 'brad pitt', 'leonardo dicaprio', 'scarlett johansson',
      'beyonce', 'rihanna', 'taylor swift', 'drake', 'kanye',
      'elon musk', 'zuckerberg', 'bezos',
    ],
  },
  brands: {
    severity: 'review',
    weight: 45,
    label: 'Third-party trademark',
    terms: [
      'nike', 'adidas', 'puma', 'reebok', 'under armour',
      'apple', 'google', 'microsoft', 'samsung', 'sony',
      'marvel', 'disney', 'pixar', 'netflix', 'warner bros', 'dc comics',
      'pokemon', 'nintendo', 'playstation', 'xbox',
      'coca cola', 'cocacola', 'pepsi', 'starbucks', 'mcdonalds',
      'gucci', 'prada', 'chanel', 'louis vuitton', 'rolex', 'hermes',
      'ferrari', 'lamborghini', 'porsche', 'bmw', 'mercedes', 'tesla',
      'visa', 'mastercard', 'amex', 'american express', 'rupay', 'paypal',
    ],
  },
  political: {
    severity: 'review',
    weight: 60,
    label: 'Political figure / symbol',
    terms: [
      'trump', 'biden', 'obama', 'clinton', 'bush',
      'modi', 'gandhi', 'nehru', 'rahul gandhi', 'kejriwal', 'yogi',
      'putin', 'zelensky', 'xi jinping', 'kim jong', 'netanyahu',
      'congress party', 'republican', 'democrat',
      'swastika', 'hammer and sickle', 'confederate',
    ],
  },
  religious: {
    severity: 'review',
    weight: 60,
    label: 'Religious figure / symbol',
    terms: [
      'jesus', 'christ', 'allah', 'muhammad', 'prophet',
      'buddha', 'krishna', 'shiva', 'vishnu', 'ganesh', 'ganesha',
      'rama', 'hanuman', 'durga', 'kali', 'lakshmi',
      'guru nanak', 'waheguru', 'yahweh', 'jehovah',
      'crucifix', 'quran', 'bible', 'torah', 'gita',
    ],
  },
};

/** Categories whose hits hard-block, regardless of the weighted score. */
export const HARD_BLOCK_CATEGORIES = Object.entries(CATEGORIES)
  .filter(([, c]) => c.severity === 'block')
  .map(([k]) => k);

/**
 * Name policy is narrower than prompt policy.
 *
 * A cardholder name is a claim about a real person, so trademark/celebrity/
 * political/religious overlap is usually a genuine legal name ("Jesus Cruz",
 * "Tesla" as a surname) and must not be auto-rejected — a human looks at it.
 * Profanity and slurs stay hard blocks: nothing legitimate is embossed there.
 */
export function nameSeverityFor(category) {
  const c = CATEGORIES[category];
  if (!c) return 'review';
  if (category === 'profanity' || category === 'slurs') return 'block';
  // Weapons/unsafe words in a name are near-certainly abuse, but surnames like
  // "Gunn" or "Blood" exist, so route rather than reject outright.
  return 'review';
}
