// Persistence for the ops review queue (server only).
//
// The queue used to live in React state, so every visitor had their own copy and
// a reload wiped it. That is fine for a solo walkthrough and visibly broken as
// soon as two people share the link — one submits, the other sees nothing.
//
// Storage is a Redis hash keyed by submission id, reached over Upstash's HTTP
// REST API. HTTP rather than a TCP client because serverless functions cannot
// hold a connection pool, and a hash rather than one JSON blob so two reviewers
// deciding different items concurrently cannot clobber each other.
//
// Provisioning: add Vercel's Upstash/KV integration to the project. It injects
// KV_REST_API_URL and KV_REST_API_TOKEN automatically and this module picks them
// up with no code change.
//
// Without those variables it falls back to per-instance memory. That fallback is
// NOT silent: every response reports `storage: "memory"` and the ops UI shows a
// warning, because a queue that quietly forgets things is worse than one that
// says it will.

import { OPS_SEED } from '../shared/opsSeed.js';

const HASH_KEY = 'hyperface:submissions:v1';
const HISTORY_KEY = 'hyperface:history:v1';
const SEEDED_KEY = 'hyperface:seeded:v1';

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url: url?.replace(/\/$/, ''), token, configured: !!(url && token) };
}

export function storageMode() {
  return config().configured ? 'kv' : 'memory';
}

// ── In-memory fallback ─────────────────────────────────────────────────────
// Module scope survives warm invocations on a single instance only.
const mem = { queue: new Map(), history: [], seeded: false };

// ── Upstash REST ───────────────────────────────────────────────────────────
async function redis(command) {
  const { url, token } = config();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`KV ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`KV error: ${String(data.error).slice(0, 160)}`);
  return data.result;
}

function parseHash(result) {
  // HGETALL over REST returns a flat [field, value, field, value, ...] array.
  const out = [];
  if (!Array.isArray(result)) return out;
  for (let i = 0; i + 1 < result.length; i += 2) {
    try {
      out.push(JSON.parse(result[i + 1]));
    } catch {
      /* skip an unreadable row rather than failing the whole listing */
    }
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** All pending submissions, newest first. */
export async function listSubmissions() {
  if (!config().configured) {
    return [...mem.queue.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
  const rows = parseHash(await redis(['HGETALL', HASH_KEY]));
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getSubmission(id) {
  if (!config().configured) return mem.queue.get(id) ?? null;
  const raw = await redis(['HGET', HASH_KEY, id]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putSubmission(item) {
  if (!config().configured) {
    mem.queue.set(item.id, item);
    return item;
  }
  await redis(['HSET', HASH_KEY, item.id, JSON.stringify(item)]);
  return item;
}

export async function deleteSubmission(id) {
  if (!config().configured) return mem.queue.delete(id);
  await redis(['HDEL', HASH_KEY, id]);
  return true;
}

/** Decided items, capped so the log cannot grow without bound. */
const HISTORY_MAX = 100;

export async function listHistory() {
  if (!config().configured) return mem.history.slice(0, HISTORY_MAX);
  const rows = await redis(['LRANGE', HISTORY_KEY, 0, HISTORY_MAX - 1]);
  if (!Array.isArray(rows)) return [];
  return rows.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export async function pushHistory(item) {
  if (!config().configured) {
    mem.history.unshift(item);
    mem.history.length = Math.min(mem.history.length, HISTORY_MAX);
    return;
  }
  await redis(['LPUSH', HISTORY_KEY, JSON.stringify(item)]);
  await redis(['LTRIM', HISTORY_KEY, 0, HISTORY_MAX - 1]);
}

/**
 * Seed the demo rows once, so a walkthrough does not open onto an empty queue.
 *
 * Guarded by a marker key rather than an emptiness check: once a reviewer has
 * cleared the queue it must stay cleared, not spring back on the next page load.
 */
export async function ensureSeeded() {
  const base = Date.now() - 15 * 60 * 1000;
  const rows = OPS_SEED.map((row, i) => ({
    ...row,
    createdAt: base + i * 60 * 1000,
  }));

  if (!config().configured) {
    if (mem.seeded) return false;
    mem.seeded = true;
    for (const row of rows) mem.queue.set(row.id, row);
    return true;
  }

  // SET NX returns null when the marker already exists.
  const claimed = await redis(['SET', SEEDED_KEY, String(Date.now()), 'NX']);
  if (!claimed) return false;
  const cmd = ['HSET', HASH_KEY];
  for (const row of rows) cmd.push(row.id, JSON.stringify(row));
  await redis(cmd);
  return true;
}

/** Reachability probe surfaced by the ops UI. */
export async function storageHealth() {
  const { configured } = config();
  if (!configured) {
    return { mode: 'memory', ok: true, note: 'No KV store configured — the queue is per-instance and resets.' };
  }
  try {
    await redis(['PING']);
    return { mode: 'kv', ok: true };
  } catch (err) {
    return { mode: 'kv', ok: false, note: err.message };
  }
}
