// Ops review queue API.
//
// GET    /api/submissions            list pending + decided
// POST   /api/submissions            create (requires a signed verdict)
// PATCH  /api/submissions            decide  { id, action: approve|reject, reason? }
//
// One function with three methods rather than three routes, to stay well inside
// Vercel's per-project function limit.
//
// Trust model: the browser supplies presentation data (name, style, thumbnail)
// but NOT the verdict. The risk score and decision come from the signed token
// minted by /api/generate, so a tampered client cannot submit artwork as approved
// or smuggle a rejected design into the queue.
//
// NOT IMPLEMENTED: authentication. Anyone who can reach this can approve or
// reject. That is the largest outstanding gap and is documented in the README.

import {
  listSubmissions, listHistory, getSubmission, putSubmission,
  deleteSubmission, pushHistory, storageMode, storageHealth, ensureSeeded,
} from './_store.js';
import { verifyVerdict } from './_verdict.js';
import { validateCardholderName } from '../shared/guardrails/index.js';
import { sanitizeSelections, sanitizeOrientation } from '../shared/prompt.js';

const MAX_THUMB_BYTES = 400 * 1024;   // base64-decoded
const MAX_REASON = 500;
const RATE = { windowMs: 60_000, max: 30 };
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE.max;
}

const clientKey = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'unknown';
};

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' ? body : null;
}

function newId() {
  // Short, human-quotable id for the ops floor. Collisions are checked below.
  return 'CUST-' + Math.floor(1000 + Math.random() * 9000);
}

export default async function handler(req, res) {
  if (rateLimited(clientKey(req))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    if (req.method === 'GET')   return await handleList(res);
    if (req.method === 'POST')  return await handleCreate(req, res);
    if (req.method === 'PATCH') return await handleDecide(req, res);
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[submissions]', err);
    return res.status(500).json({ error: err.message, storage: storageMode() });
  }
}

// ── GET ────────────────────────────────────────────────────────────────────
async function handleList(res) {
  const health = await storageHealth();
  // Only attempt seeding when storage is actually reachable.
  if (health.ok) {
    try { await ensureSeeded(); } catch (err) { console.warn('[seed]', err.message); }
  }

  const [queue, history] = await Promise.all([listSubmissions(), listHistory()]);
  const decided = history.length;
  const approved = history.filter(h => h.outcome === 'approved');

  return res.status(200).json({
    queue,
    history: {
      approved,
      rejected: history.filter(h => h.outcome === 'rejected'),
    },
    // Real figures, computed from what actually happened. The header previously
    // showed hardcoded "87% auto-approved" and "4.2s latency", which would not
    // survive a question from anyone reading the dashboard.
    stats: {
      inQueue: queue.length,
      decided,
      approvalRate: decided ? Math.round((approved.length / decided) * 100) : null,
      autoApproved: queue.filter(q => q.decision?.code === 'AUTO_APPROVE').length,
    },
    storage: health.mode,
    storageOk: health.ok,
    storageNote: health.note,
  });
}

// ── POST ───────────────────────────────────────────────────────────────────
async function handleCreate(req, res) {
  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

  // The verdict must come from a signature we minted, not from the request.
  const verified = verifyVerdict(body.verdictToken);
  if (!verified.ok) {
    return res.status(403).json({ error: verified.reason });
  }
  const v = verified.payload;

  // A design the guardrails refused can never enter the review queue, no matter
  // what the client claims.
  if (v.decision === 'REJECTED' || v.hardBlocked) {
    return res.status(422).json({
      error: 'This design was blocked by moderation and cannot be submitted.',
    });
  }

  // Re-validate the name server-side: the field stays editable after generation,
  // so the submitted value is not guaranteed to be the one that was checked.
  const name = validateCardholderName(body.cardholderName);
  if (name.empty || name.severity === 'block') {
    return res.status(422).json({
      error: name.reasons?.[0]?.message || 'Cardholder name is not acceptable.',
      field: 'cardholderName',
    });
  }

  let thumbnail = null;
  if (typeof body.thumbnail === 'string') {
    const m = body.thumbnail.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Unsupported thumbnail format' });
    if (m[2].length * 0.75 > MAX_THUMB_BYTES) {
      return res.status(413).json({ error: 'Thumbnail too large' });
    }
    thumbnail = body.thumbnail;
  }

  const selections = sanitizeSelections(body.selections);
  const iterations = {
    total: Math.max(0, parseInt(body.iterations?.total, 10) || 0),
    horizontal: Math.max(0, parseInt(body.iterations?.horizontal, 10) || 0),
    vertical: Math.max(0, parseInt(body.iterations?.vertical, 10) || 0),
  };

  let id = newId();
  for (let i = 0; i < 5 && await getSubmission(id); i++) id = newId();

  const item = {
    id,
    createdAt: Date.now(),
    cardholderName: name.normalized,
    ...selections,
    orientation: sanitizeOrientation(body.orientation),
    thumbnail,
    iterations,
    // Everything below is server-authoritative, taken from the signed token.
    risk: v.riskScore,
    safety: v.safetyScore,
    confidence: v.confidence ?? null,
    decision: v.decisionObject ?? { code: v.decision, label: v.decisionLabel },
    signals: v.signals ?? null,
    flags: v.flags ?? [],
    moderation: v.moderation ?? null,
    isUserSubmission: true,
  };

  await putSubmission(item);
  return res.status(201).json({ item, storage: storageMode() });
}

// ── PATCH ──────────────────────────────────────────────────────────────────
async function handleDecide(req, res) {
  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

  const { id, action } = body;
  if (!id || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Expected { id, action: "approve" | "reject" }' });
  }

  const item = await getSubmission(id);
  if (!item) return res.status(404).json({ error: 'Submission not found (already decided?)' });

  const reason = String(body.reason ?? '').slice(0, MAX_REASON).trim();
  if (action === 'reject' && !reason) {
    return res.status(400).json({ error: 'A rejection reason is required', field: 'reason' });
  }

  const decided = {
    ...item,
    outcome: action === 'approve' ? 'approved' : 'rejected',
    decidedAt: Date.now(),
    reason: action === 'reject' ? reason : undefined,
  };

  await pushHistory(decided);
  await deleteSubmission(id);
  return res.status(200).json({ item: decided, storage: storageMode() });
}
