// Signed verdict tokens (server only).
//
// The problem: /api/submissions must know the authoritative moderation verdict,
// but it cannot trust the browser to report it — a tampered client could POST
// `decision: AUTO_APPROVE` for artwork that was actually rejected. Re-running the
// classifier on submit would be correct but costs a second paid call per submit.
//
// So /api/generate signs the verdict it computed and hands the token to the
// client, which passes it back on submit. The server verifies the signature and
// uses the payload inside. The browser can read the token but cannot forge one.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// Tokens are short-lived so one cannot be replayed days later.
const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Signing secret.
 *
 * Prefers an explicit SUBMISSION_SECRET. Falls back to a hash of GEMINI_API_KEY,
 * which is always present in a working deployment and stable across instances —
 * a random per-instance secret would break verification as soon as a second
 * serverless instance handled the submit.
 */
function secret() {
  const explicit = process.env.SUBMISSION_SECRET;
  if (explicit) return explicit;
  const derived = process.env.GEMINI_API_KEY;
  if (derived) return createHash('sha256').update(`hyperface:verdict:${derived}`).digest('hex');
  return null;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(data, key) {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Sign a verdict. Returns null when no secret is available. */
export function signVerdict(payload) {
  const key = secret();
  if (!key) return null;
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  return `${body}.${hmac(body, key)}`;
}

/**
 * Verify a token.
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 */
export function verifyVerdict(token) {
  const key = secret();
  if (!key) return { ok: false, reason: 'Server is not configured to verify verdicts' };
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'Malformed verdict token' };
  }

  const [body, sig] = token.split('.');
  const expected = hmac(body, key);

  // Constant-time compare; timingSafeEqual throws on length mismatch.
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Verdict signature does not match' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'Unreadable verdict payload' };
  }

  if (!payload?.iat || Date.now() - payload.iat > TTL_MS) {
    return { ok: false, reason: 'Verdict has expired — please regenerate your design' };
  }

  return { ok: true, payload };
}
