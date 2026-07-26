// Client for the ops queue API.
//
// The queue is server state now, so every visitor sees the same items and they
// survive a reload. Previously it lived in React state: one person submitted and
// another saw nothing.

async function call(method, body) {
  const res = await fetch('/api/submissions', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* fall through to status text */ }

  if (!res.ok) {
    const err = new Error(payload?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.field = payload?.field;
    throw err;
  }
  return payload;
}

/** Pending queue + decided history + storage health. */
export function fetchQueue() {
  return call('GET');
}

/**
 * Submit a design for review.
 * `verdictToken` is the signed verdict from /api/generate — without it the
 * server refuses, since it will not take the browser's word on a decision.
 */
export function createSubmission(payload) {
  return call('POST', payload);
}

export function decideSubmission({ id, action, reason }) {
  return call('PATCH', { id, action, reason });
}

/**
 * Shrink artwork for the queue thumbnail.
 *
 * Generated images arrive as ~1 MB base64 data URLs; storing three of those per
 * submission would push past the KV request limit for no benefit, since the ops
 * card renders small.
 */
export function makeThumbnail(dataURL, maxDim = 512, quality = 0.72) {
  return new Promise((resolve) => {
    if (!dataURL) return resolve(null);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(null); // tainted canvas (e.g. a remote provider URL)
      }
    };
    // A thumbnail is a nicety; never block submission on it.
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}
