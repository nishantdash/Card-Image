// Issuer Bank Card Template Registry + Embosser-ready compositor.
// Internal backend capability — not surfaced in the customer UI.

function buildAUBankFrontMock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1713 1080">
    <defs>
      <linearGradient id="auFront" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#E8002A"/>
        <stop offset="1" stop-color="#7A0014"/>
      </linearGradient>
    </defs>
    <rect width="1713" height="1080" rx="80" fill="url(#auFront)"/>
    <text x="110" y="180" font-family="Arial,Helvetica,sans-serif" font-size="84" font-weight="800" fill="#fff" letter-spacing="10">AU BANK</text>
    <rect x="110" y="300" width="180" height="140" rx="14" fill="#d4af37" stroke="#8a6420" stroke-width="3"/>
    <text x="110" y="780" font-family="monospace" font-size="76" fill="#fff" letter-spacing="6">4024 •••• •••• 8901</text>
    <text x="110" y="920" font-family="Arial,Helvetica,sans-serif" font-size="36" fill="#fff" opacity="0.75">CARDHOLDER</text>
    <text x="110" y="980" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#fff">YOUR NAME</text>
    <text x="1380" y="980" font-family="Arial,Helvetica,sans-serif" font-size="100" font-weight="900" font-style="italic" fill="#fff">VISA</text>
  </svg>`;
}

function buildAUBankBackMock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1713 1080">
    <rect width="1713" height="1080" rx="80" fill="#1c1c1e"/>
    <rect x="0" y="120" width="1713" height="200" fill="#000"/>
    <rect x="110" y="420" width="1230" height="160" fill="#f4f4f4"/>
    <text x="130" y="520" font-family="monospace" font-size="60" fill="#111">authorized signature</text>
    <rect x="1370" y="420" width="230" height="160" fill="#fff"/>
    <text x="1410" y="520" font-family="monospace" font-size="56" fill="#111">•••</text>
    <text x="110" y="900" font-family="Arial,Helvetica,sans-serif" font-size="32" fill="#bbb">AU Small Finance Bank Ltd.</text>
    <text x="110" y="960" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#888">For customer service call 1800-1200-1200</text>
  </svg>`;
}

const svgToDataURL = (svg) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

export const BANK_REGISTRY = {
  AU_BANK: {
    code: 'AU_BANK',
    name: 'AU Small Finance Bank',
    displayName: 'AU BANK',
    network: 'visa',
    brandColor: '#E8002A',
    templates: {
      front: {
        url: svgToDataURL(buildAUBankFrontMock()),
        dimensions: { w: 1713, h: 1080, dpi: 600 },
        embossableArea: { x: 0, y: 0, w: 1713, h: 1080 },
        chipCutout:    { x: 110,  y: 300, w: 180,  h: 140 },
        brandPlate:    { x: 1340, y: 880, w: 260,  h: 130 },
        namePlate:     { x: 110,  y: 880, w: 1000, h: 110 },
        numberPlate:   { x: 110,  y: 700, w: 1300, h: 110 },
      },
      back: {
        url: svgToDataURL(buildAUBankBackMock()),
        dimensions: { w: 1713, h: 1080, dpi: 600 },
        magstripe: { x: 0,    y: 120, w: 1713, h: 200 },
        signature: { x: 110,  y: 420, w: 1230, h: 160 },
        cvvPlate:  { x: 1370, y: 420, w: 230,  h: 160 },
      },
    },
    constraints: {
      minDpi: 600,
      colorProfile: 'sRGB',
      bleed: 18,
      reservedColors: ['Pantone 185 C'],
    },
    approvedBy: 'AU Bank Card Operations',
    templateVersion: 'v3.2.1',
    lastUpdated: '2025-11-04',
  },
};

export async function fetchBankCardTemplate(issuerCode) {
  console.log('[bank-template] fetching approved template for', issuerCode);
  const entry = BANK_REGISTRY[issuerCode];
  if (!entry) {
    throw new Error(`No approved card template registered for issuer "${issuerCode}"`);
  }
  await new Promise(r => setTimeout(r, 200));
  console.log(
    '[bank-template] resolved %s · %s · front %dx%d @ %ddpi',
    entry.name,
    entry.templateVersion,
    entry.templates.front.dimensions.w,
    entry.templates.front.dimensions.h,
    entry.templates.front.dimensions.dpi,
  );
  return JSON.parse(JSON.stringify(entry));
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + src.slice(0, 60)));
    img.src = src;
  });
}

function drawImageCover(ctx, img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let sw, sh, sx, sy;
  if (ir > cr) {
    sh = img.naturalHeight;
    sw = sh * cr;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / cr;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function composeEmbosserReadyArtwork(bankTemplate, aiImageSrc) {
  const front = bankTemplate.templates.front;
  const back  = bankTemplate.templates.back;
  const { w, h, dpi } = front.dimensions;

  console.log(
    '[embosser] compositing AI artwork onto %s template (%dx%d @ %ddpi)',
    bankTemplate.name, w, h, dpi,
  );

  let aiImg;
  try {
    aiImg = await loadImageEl(aiImageSrc);
  } catch (err) {
    throw new Error('Embosser compositor could not load AI image: ' + err.message);
  }

  const frontCanvas = document.createElement('canvas');
  frontCanvas.width  = w;
  frontCanvas.height = h;
  const fctx = frontCanvas.getContext('2d');

  fctx.clearRect(0, 0, w, h);
  const area = front.embossableArea;
  drawImageCover(fctx, aiImg, area.x, area.y, area.w, area.h);

  fctx.save();
  fctx.globalAlpha = 0.002;
  fctx.fillStyle = '#000';
  for (const zone of [front.chipCutout, front.brandPlate, front.namePlate, front.numberPlate]) {
    if (zone) fctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  }
  fctx.restore();

  let frontDataURL;
  try {
    frontDataURL = frontCanvas.toDataURL('image/png');
  } catch (err) {
    throw new Error('Canvas tainted — cannot export embosser PNG. Use a CORS-enabled provider (Gemini/DALL·E/Stability). Underlying: ' + err.message);
  }

  let backDataURL = back.url;
  try {
    const backImg = await loadImageEl(back.url);
    const backCanvas = document.createElement('canvas');
    backCanvas.width  = back.dimensions.w;
    backCanvas.height = back.dimensions.h;
    const bctx = backCanvas.getContext('2d');
    bctx.drawImage(backImg, 0, 0, back.dimensions.w, back.dimensions.h);
    backDataURL = backCanvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[embosser] back template re-encode skipped:', err.message);
  }

  const payload = {
    issuer: bankTemplate.code,
    issuerName: bankTemplate.name,
    templateVersion: bankTemplate.templateVersion,
    front: {
      dataURL: frontDataURL,
      dimensions: { w, h, dpi },
      colorProfile: bankTemplate.constraints.colorProfile,
      bleed: bankTemplate.constraints.bleed,
    },
    back: {
      dataURL: backDataURL,
      dimensions: back.dimensions,
    },
    composedAt: new Date().toISOString(),
  };

  console.log(
    '[embosser] ready · front %dKB · back %dKB · template %s',
    Math.round(payload.front.dataURL.length * 0.75 / 1024),
    Math.round(payload.back.dataURL.length  * 0.75 / 1024),
    payload.templateVersion,
  );
  return payload;
}
