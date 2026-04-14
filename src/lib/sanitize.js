export const RESTRICTED = {
  celebrities: ['iron man','hrithik','virat','kohli','ronaldo','messi','shahrukh','srk','tom cruise','beyonce','rihanna','taylor swift','elon musk'],
  brands:      ['nike','apple','marvel','disney','coca cola','pepsi','adidas','gucci','ferrari','lamborghini'],
  political:   ['trump','modi','putin','biden','obama','xi jinping'],
  religious:   ['jesus','allah','buddha','krishna','shiva','cross','crescent','om'],
  weapons:     ['gun','knife','rifle','pistol','sword','bomb','grenade'],
  unsafe:      ['nude','naked','sexual','blood','gore','drug','cocaine','heroin'],
};

export const REWRITE_MAP = [
  { match: /iron\s*man/gi,                replace: 'futuristic armored hero with glowing arc reactor' },
  { match: /hrithik|agneepath/gi,         replace: 'cinematic action hero portrait' },
  { match: /virat|kohli/gi,               replace: 'athletic batsman silhouette' },
  { match: /(tom cruise|shahrukh|srk)/gi, replace: 'cinematic leading-man portrait' },
  { match: /nike|adidas/gi,               replace: 'athletic sportswear theme' },
  { match: /marvel|disney/gi,             replace: 'epic comic-book aesthetic' },
];

export function sanitizePrompt(raw) {
  let sanitized = raw || '';
  let riskScore = 0;
  const flagsHit = [];

  for (const [cat, list] of Object.entries(RESTRICTED)) {
    for (const term of list) {
      const re = new RegExp('\\b' + term + '\\b', 'gi');
      if (re.test(sanitized)) {
        flagsHit.push(cat);
        if (cat === 'celebrities') riskScore += 40;
        else if (cat === 'brands')    riskScore += 30;
        else if (cat === 'political') riskScore += 50;
        else if (cat === 'religious') riskScore += 50;
        else if (cat === 'weapons')   riskScore += 60;
        else if (cat === 'unsafe')    riskScore += 70;
      }
    }
  }
  REWRITE_MAP.forEach(({ match, replace }) => { sanitized = sanitized.replace(match, replace); });
  return { sanitized, riskScore: Math.min(riskScore, 100), flagsHit: [...new Set(flagsHit)] };
}
