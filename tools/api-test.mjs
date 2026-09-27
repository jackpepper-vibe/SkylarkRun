/*
 * Checks for the leaderboard endpoint that do not need a live database:
 * submission validation, and the behaviour when the store is unprovisioned.
 *
 *   node tools/api-test.mjs
 */
import handler, { validate, cleanName, AIRCRAFT } from "../api/scores.js";

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   " + detail : ""));
  if (!ok) failed++;
};

// --- what the board will accept ---
const good = validate({ name: "Kevin", score: 18420, lvl: 4, rings: 27, chain: 7 });
check("a normal run is accepted", !good.error && good.entry.name === "Kevin" &&
  good.entry.score === 18420, JSON.stringify(good.entry || good));

check("names keep their capitals for display", validate({ name: "Séan" }).entry === undefined ||
  cleanName("Séan") === "Séan", cleanName("Séan"));
check("one pilot cannot hold two rows by changing case",
  validate({ name: "KEVIN", score: 10, lvl: 1 }).entry.key ===
  validate({ name: "kevin", score: 10, lvl: 1 }).entry.key);
check("spaces are collapsed and trimmed", cleanName("  kev   in  ") === "kev in", cleanName("  kev   in  "));
check("markup is stripped", cleanName("<b>hi</b>") === "bhib", cleanName("<b>hi</b>"));
check("accents and apostrophes survive", cleanName("Séan O'Neill") === "Séan O'Neill");
check("a name is capped in length", cleanName("A".repeat(80)).length === 16);
check("an empty name is rejected", !!validate({ name: "   ", score: 10, lvl: 1 }).error);
check("a name of only punctuation is rejected", !!validate({ name: "<<>>", score: 10, lvl: 1 }).error);
check("a zero score is rejected", !!validate({ name: "Kevin", score: 0, lvl: 1 }).error);
check("a negative score is rejected", !!validate({ name: "Kevin", score: -5, lvl: 1 }).error);
check("a nonsense score is rejected", !!validate({ name: "Kevin", score: 9e9, lvl: 40 }).error);
check("a score too large for the sector is rejected",
  !!validate({ name: "Kevin", score: 500000, lvl: 1 }).error);
check("a plausible late-sector score is accepted",
  !validate({ name: "Kevin", score: 500000, lvl: 9 }).error);
check("chain and rings are clamped, not trusted", (() => {
  const v = validate({ name: "Kevin", score: 100, lvl: 1, rings: 1e6, chain: 99 });
  return v.entry.rings === 999 && v.entry.chain === 8;
})());
check("garbage body does not throw", !!validate({}).error && !!validate({ name: 1, score: "x" }).error);
check("the aircraft is kept when it is one of the hangar's",
  validate({ name: "Kevin", score: 100, lvl: 1, aircraft: "linnet" }).entry.aircraft === "linnet");
check("an unknown aircraft is dropped, not trusted, and the run still counts",
  validate({ name: "Kevin", score: 100, lvl: 1, aircraft: "<x>" }).entry.aircraft === null);
{
  // the endpoint's list and the hangar's must name the same aeroplanes
  const src = (await import("fs")).readFileSync(new URL("../src/plane/aircraft.js", import.meta.url), "utf8");
  const ids = [...src.matchAll(/^\s*id: "([a-z]+)"/gm)].map(m => m[1]);
  check("the endpoint knows every aircraft in the hangar",
    ids.length === AIRCRAFT.length && ids.every(i => AIRCRAFT.includes(i)), ids.join(","));
}

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
