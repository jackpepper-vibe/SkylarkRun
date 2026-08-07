/*
 * Global logbook for Skylark Run.
 *
 *   GET  /api/scores            top pilots, best run each
 *   POST /api/scores            submit a run: { name, score, lvl, rings, chain }
 *
 * Backed by an Upstash Redis sorted set: member is the pilot's initials, score
 * is their best run, so the board shows ten distinct pilots rather than one
 * good session ten times. Run detail lives in a parallel hash.
 *
 * If the store is not provisioned the endpoint reports that plainly and the
 * game falls back to its local logbook — it never blocks play.
 */
import { Redis } from "@upstash/redis";

const BOARD = "skylark:board:v1";
const META = "skylark:meta:v1";
const KEEP = 100; // pilots retained
const TOP = 10; // pilots returned

// Marketplace Upstash injects KV_REST_API_*; a direct Upstash account injects
// UPSTASH_REDIS_REST_*. Accept either so provisioning route does not matter.
let client;
function db() {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

const clean = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

// The client is a web page, so a determined person can post whatever they like.
// These bounds only keep casual nonsense off the board; they are not security.
export function validate(body) {
  const name = String(body && body.name || "")
    .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  if (name.length !== 3) return { error: "name must be three letters" };
  const score = Math.floor(Number(body.score));
  if (!Number.isFinite(score) || score <= 0) return { error: "score must be a positive number" };
  if (score > 2000000) return { error: "score is not plausible" };
  const lvl = clean(body.lvl, 1, 99);
  const rings = clean(body.rings, 0, 999);
  const chain = clean(body.chain, 0, 8);
  // a sector is worth a few thousand at best; well over that means a bad actor
  if (score > 90000 * lvl) return { error: "score does not match the sector reached" };
  return { entry: { name, score, lvl, rings, chain, at: Date.now() } };
}

async function readBoard(r) {
  const rows = await r.zrange(BOARD, 0, TOP - 1, { rev: true, withScores: true });
  const out = [];
  for (let i = 0; i < rows.length; i += 2) {
    out.push({ name: String(rows[i]), score: Number(rows[i + 1]) });
  }
  if (!out.length) return out;
  const meta = await r.hmget(META, ...out.map((e) => e.name));
  out.forEach((e, i) => {
    const m = meta && (meta[e.name] !== undefined ? meta[e.name] : meta[i]);
    const d = typeof m === "string" ? safeParse(m) : m;
    if (d) { e.lvl = d.lvl; e.rings = d.rings; e.chain = d.chain; e.at = d.at; }
  });
  return out;
}
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// crude per-address throttle: a handful of submissions a minute is plenty
async function throttled(r, req) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const key = "skylark:rl:" + ip;
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, 60);
  return n > 12;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const r = db();
  if (!r) {
    return res.status(503).json({ ok: false, configured: false, board: [],
      error: "leaderboard store is not configured" });
  }
  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, configured: true, board: await readBoard(r) });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const { error, entry } = validate(body || {});
      if (error) return res.status(400).json({ ok: false, configured: true, error });
      if (await throttled(r, req)) {
        return res.status(429).json({ ok: false, configured: true, error: "too many submissions" });
      }
      // gt: only overwrite when this run beats the pilot's own best.
      // ch is what makes the reply count *changed* members — without it an
      // improved score returns 0 (only brand-new members count) and the run
      // detail below would never be refreshed.
      const improved = await r.zadd(BOARD, { gt: true, ch: true },
        { score: entry.score, member: entry.name });
      if (improved) await r.hset(META, { [entry.name]: JSON.stringify(entry) });
      await r.zremrangebyrank(BOARD, 0, -(KEEP + 1));
      const rank = await r.zrevrank(BOARD, entry.name);
      return res.status(200).json({
        ok: true, configured: true, improved: !!improved,
        rank: rank === null || rank === undefined ? null : rank + 1,
        board: await readBoard(r)
      });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, configured: true, board: [],
      error: "leaderboard unavailable" });
  }
}
