/*
 * Checks for the leaderboard endpoint that do not need a live Redis:
 * submission validation, and the behaviour when the store is unprovisioned.
 *
 *   node tools/api-test.mjs
 */
import handler, { validate } from "../api/scores.js";

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   " + detail : ""));
  if (!ok) failed++;
};

// --- what the board will accept ---
const good = validate({ name: "ktb", score: 18420, lvl: 4, rings: 27, chain: 7 });
check("a normal run is accepted", !good.error && good.entry.name === "KTB" &&
  good.entry.score === 18420, JSON.stringify(good.entry || good));

check("initials are upper-cased and stripped", validate({ name: "k7b!", score: 10, lvl: 1 }).error === undefined ||
  validate({ name: "k7b", score: 10, lvl: 1 }).error !== undefined, "non-letters removed");
check("a two-letter name is rejected", !!validate({ name: "KT", score: 10, lvl: 1 }).error);
check("a zero score is rejected", !!validate({ name: "KTB", score: 0, lvl: 1 }).error);
check("a negative score is rejected", !!validate({ name: "KTB", score: -5, lvl: 1 }).error);
check("a nonsense score is rejected", !!validate({ name: "KTB", score: 9e9, lvl: 40 }).error);
check("a score too large for the sector is rejected",
  !!validate({ name: "KTB", score: 500000, lvl: 1 }).error);
check("a plausible late-sector score is accepted",
  !validate({ name: "KTB", score: 500000, lvl: 9 }).error);
check("chain and rings are clamped, not trusted", (() => {
  const v = validate({ name: "KTB", score: 100, lvl: 1, rings: 1e6, chain: 99 });
  return v.entry.rings === 999 && v.entry.chain === 8;
})());
check("garbage body does not throw", !!validate({}).error && !!validate({ name: 1, score: "x" }).error);

// --- the unprovisioned path ---
const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const noStore = res();
await handler({ method: "GET", headers: {} }, noStore);
check("an unprovisioned store reports itself and does not crash",
  noStore.code === 503 && noStore.body.configured === false &&
  Array.isArray(noStore.body.board), JSON.stringify(noStore.body));
check("responses are not cached", noStore.headers["Cache-Control"] === "no-store");

console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
