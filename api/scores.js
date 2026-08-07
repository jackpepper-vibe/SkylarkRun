/*
 * Global logbook for Skylark Run.
 *
 *   GET  /api/scores            top pilots, best run each
 *   POST /api/scores            submit a run: { name, score, lvl, rings, chain }
 *
 * Backed by Neon Postgres on the free Marketplace plan — the same store the
 * other games use, in its own table. One row per pilot, keyed on their initials
 * and only overwritten by a better run, so the board shows ten distinct pilots
 * rather than one good session ten times.
 *
 * If the store is not provisioned the endpoint reports that plainly and the
 * game falls back to its local logbook — it never blocks play.
 */
import { neon } from "@neondatabase/serverless";

const TOP = 10;
const RATE_PER_MIN = 12;

function connString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
}

// Lazy per-instance init: connect and ensure the tables exist once per cold
// start, without crashing a build that has no connection string yet.
let ready = null;
function db() {
  if (ready) return ready;
  const url = connString();
  if (!url) return null;
  ready = (async () => {
    const sql = neon(url);
    await sql`
      CREATE TABLE IF NOT EXISTS skylark_scores (
        name       text PRIMARY KEY,
        score      integer NOT NULL,
        lvl        integer NOT NULL DEFAULT 1,
        rings      integer NOT NULL DEFAULT 0,
        chain      integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS skylark_scores_score ON skylark_scores (score DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS skylark_rate (
        ip    text PRIMARY KEY,
        n     integer NOT NULL,
        since timestamptz NOT NULL DEFAULT now()
      )`;
    return sql;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const clean = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

// The client is a web page, so a determined person can post whatever they like.
// These bounds only keep casual nonsense off the board; they are not security.
export function validate(body) {
  const name = String((body && body.name) || "")
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
  return { entry: { name, score, lvl, rings, chain } };
}

const board = (sql) => sql`
  SELECT name, score, lvl, rings, chain
  FROM skylark_scores
  ORDER BY score DESC, updated_at ASC
  LIMIT ${TOP}`;

// crude per-address throttle: a handful of submissions a minute is plenty
async function throttled(sql, req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const rows = await sql`
    INSERT INTO skylark_rate (ip, n) VALUES (${ip}, 1)
    ON CONFLICT (ip) DO UPDATE SET
      n     = CASE WHEN skylark_rate.since < now() - interval '1 minute' THEN 1
                   ELSE skylark_rate.n + 1 END,
      since = CASE WHEN skylark_rate.since < now() - interval '1 minute' THEN now()
                   ELSE skylark_rate.since END
    RETURNING n`;
  return rows[0] && rows[0].n > RATE_PER_MIN;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!connString()) {
    return res.status(503).json({ ok: false, configured: false, board: [],
      error: "leaderboard store is not configured" });
  }
  try {
    const sql = await db();
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, configured: true, board: await board(sql) });
    }
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const { error, entry } = validate(body || {});
      if (error) return res.status(400).json({ ok: false, configured: true, error });
      if (await throttled(sql, req)) {
        return res.status(429).json({ ok: false, configured: true, error: "too many submissions" });
      }
      // one row per pilot, replaced only by a better run
      const improved = await sql`
        INSERT INTO skylark_scores (name, score, lvl, rings, chain)
        VALUES (${entry.name}, ${entry.score}, ${entry.lvl}, ${entry.rings}, ${entry.chain})
        ON CONFLICT (name) DO UPDATE SET
          score = EXCLUDED.score, lvl = EXCLUDED.lvl, rings = EXCLUDED.rings,
          chain = EXCLUDED.chain, updated_at = now()
        WHERE skylark_scores.score < EXCLUDED.score
        RETURNING name`;
      const best = await sql`SELECT score FROM skylark_scores WHERE name = ${entry.name}`;
      const at = best[0] ? best[0].score : entry.score;
      const ahead = await sql`SELECT count(*)::int AS n FROM skylark_scores WHERE score > ${at}`;
      return res.status(200).json({
        ok: true, configured: true,
        improved: improved.length > 0,
        rank: ahead[0].n + 1,
        board: await board(sql)
      });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, configured: true, board: [],
      error: "leaderboard unavailable" });
  }
}
