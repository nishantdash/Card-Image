import { sanitizePrompt } from './sanitize.js';

export const PROVIDERS = {
  pollinations: {
    label: 'Pollinations.ai',
    needsKey: false,
    keyHint: '(no key required)',
  },
  gemini: {
    label: 'Google Gemini · Nano Banana',
    needsKey: true,
    keyHint: '(Google AI Studio key — same key works for Gemini 2.5 models)',
  },
  dalle: {
    label: 'OpenAI DALL·E 3',
    needsKey: true,
    keyHint: '(OpenAI API key starting with sk-…)',
  },
  grok: {
    label: 'xAI Grok Image',
    needsKey: true,
    keyHint: '(xAI API key starting with xai-…)',
  },
  stability: {
    label: 'Stability AI',
    needsKey: true,
    keyHint: '(Stability API key starting with sk-…)',
  },
};

export function buildFullPrompt(selections, freeText) {
  const { style, mood, color, background } = selections;
  const parts = [];
  if (style)      parts.push(style.replace('-', ' ') + ' style');
  if (mood)       parts.push(mood + ' mood');
  if (color)      parts.push(color + ' color palette');
  if (background) parts.push(background.replace('-', ' ') + ' background');
  parts.push('luxury credit card artwork, premium design, ultra detailed, 4k');

  let prompt = parts.join(', ');
  if (freeText && freeText.trim()) {
    const sanitized = sanitizePrompt(freeText).sanitized;
    prompt = sanitized + ', ' + prompt;
  }
  return prompt;
}

export function buildEditPrompt(selections, freeText) {
  const { style, mood, color, background } = selections;
  const styleName = style ? style.replace('-', ' ') : 'artistic';

  const fragments = [];
  fragments.push(`Completely re-render this photograph in ${styleName} art style`);
  if (mood)       fragments.push(`with a strong ${mood} mood`);
  if (color)      fragments.push(`using a ${color} color palette`);
  if (background) fragments.push(`set against a ${background.replace('-', ' ')} background`);

  let prompt =
    fragments.join(', ') +
    `. The output MUST look visually and stylistically distinct from the input — apply heavy artistic stylization, redraw the subject from scratch in pure ${styleName} style. ` +
    `Maintain the subject's pose and identity but transform the entire rendering style, lighting, color and texture. ` +
    `Frame the result as luxury credit card artwork: premium, ultra-detailed, 16:9 landscape, embosser-friendly composition.`;

  if (freeText && freeText.trim()) {
    const sanitized = sanitizePrompt(freeText).sanitized;
    prompt += ' Additional direction: ' + sanitized;
  }
  return prompt;
}

export function buildPreviewPrompt(selections, freeText) {
  const { style, mood, color, background } = selections;
  const parts = [];
  if (style)      parts.push(style.replace('-', ' ') + ' style');
  if (mood)       parts.push(mood + ' mood');
  if (color)      parts.push(color + ' palette');
  if (background) parts.push(background.replace('-', ' ') + ' background');
  parts.push('high resolution, card friendly composition');

  let prompt = parts.join(', ');
  if (freeText && freeText.trim()) {
    prompt += ' · user note: ' + sanitizePrompt(freeText).sanitized;
  }
  return prompt;
}

export function resizeImageDataURL(dataURL, maxDim = 1024, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width  = maxDim;
        } else {
          width  = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL('image/jpeg', quality);
      const match = out.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return reject(new Error('Failed to encode resized image'));
      resolve({ dataURL: out, mimeType: match[1], base64: match[2] });
    };
    img.onerror = () => reject(new Error('Failed to decode uploaded image'));
    img.src = dataURL;
  });
}

async function generatePollinations(prompt, orientation, seedRef) {
  const safe = prompt.replace(/[^\w ,.\-]/g, '').slice(0, 380);
  const seed = seedRef.current || Math.floor(Math.random() * 100000);
  seedRef.current = seed;
  const [w, h] = orientation === 'vertical' ? [540, 864] : [864, 540];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(safe)}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
  await new Promise((res, rej) => {
    const img = new Image();
    img.onload = res;
    img.onerror = () => rej(new Error('Pollinations request failed'));
    img.src = url;
  });
  return { src: url };
}

async function generateGemini(prompt, key, inputImage, orientation) {
  const candidates = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image-preview',
  ];

  const parts = [];
  if (inputImage) {
    parts.push({ inlineData: { mimeType: inputImage.mimeType, data: inputImage.base64 } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: orientation === 'vertical' ? '9:16' : '16:9' },
    },
  };

  let lastErr;
  for (const model of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        lastErr = new Error(`${model} → ${res.status}: ${errText.slice(0, 260)}`);
        if (res.status === 404 || res.status === 400) continue;
        throw lastErr;
      }
      const data = await res.json();
      const respParts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = respParts.find(p => p.inlineData || p.inline_data);
      if (!imgPart) {
        const textPart = respParts.find(p => p.text);
        const finishReason = data?.candidates?.[0]?.finishReason;
        lastErr = new Error(
          `${model} returned no image. finishReason=${finishReason || 'n/a'}` +
          (textPart ? ` · text="${textPart.text.slice(0, 160)}"` : ''),
        );
        continue;
      }
      const inline = imgPart.inlineData || imgPart.inline_data;
      console.log('[gemini] generated via', model, inputImage ? '(edit mode)' : '(text-to-image)');
      return { src: `data:${inline.mimeType || inline.mime_type};base64,${inline.data}` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Gemini model variants failed');
}

async function generateDalle(prompt, key, orientation) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      size: orientation === 'vertical' ? '1024x1792' : '1792x1024',
      n: 1,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DALL·E ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('DALL·E returned no image');
  return { src: url };
}

async function generateGrok(prompt, key) {
  const res = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'grok-2-image', prompt, n: 1 }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('Grok returned no image');
  return { src: url };
}

async function generateStability(prompt, key, orientation) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('output_format', 'jpeg');
  form.append('aspect_ratio', orientation === 'vertical' ? '9:16' : '16:9');
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'image/*' },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Stability ${res.status}: ${errText.slice(0, 200)}`);
  }
  const blob = await res.blob();
  return { src: URL.createObjectURL(blob) };
}

export async function callProvider(settings, prompt, inputImage, orientation = 'horizontal', seedRef = { current: null }) {
  const provider = settings.provider;
  const key = settings.keys[provider] || '';
  if (PROVIDERS[provider]?.needsKey && !key) {
    throw new Error(`${PROVIDERS[provider].label} requires an API key. Configure it in the Ops Dashboard.`);
  }
  switch (provider) {
    case 'gemini':       return generateGemini(prompt, key, inputImage, orientation);
    case 'dalle':        return generateDalle(prompt, key, orientation);
    case 'grok':         return generateGrok(prompt, key);
    case 'stability':    return generateStability(prompt, key, orientation);
    case 'pollinations':
    default:             return generatePollinations(prompt, orientation, seedRef);
  }
}
