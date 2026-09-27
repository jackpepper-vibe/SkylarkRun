// Skylark Run — the tour: what each sector is, and what it asks of you.
//
// A run is a cross-country tour of five sectors, each a different stretch of
// country with its own light, weather, hazards, objective and destination
// airfield. You take off from wherever the last sector put you down. Once the
// fifth is flown the tour goes round again, harder: denser hazards, every one
// of them in play, a thirstier engine and stiffer objectives, and every point
// worth more than the time before.
//
// This module is pure data and bookkeeping. world.js turns a sector into land,
// sky and hazards; flight.js asks it what the sector is and tells it what the
// pilot did; the HUD and the overlays read the objective back.
import { G, P, award, popup } from '../state.js';
import { chime } from '../audio.js';

/**
 * The run's tallies are run-long (the flight report shows them); a sector
 * counts from where they stood when it began.
 */
const base = { rings: 0, hit: 0, gold: 0 };
const sectorRings = () => G.ringsHit - base.hit;

/** Objective kinds: what is counted, and how it reads on the briefing card. */
const OBJ = {
  rings: { text: n => `Thread ${n} rings`,           have: () => sectorRings() },
  under: { text: n => `Fly under the wires ${n}×`,   have: () => G.under },
  gold:  { text: n => `Hit ${n} gold gates`,          have: () => G.goldHit - base.gold },
  low:   { text: n => `Hedge-hop for ${n} seconds`,  have: () => Math.floor(G.lowT) },
  chain: { text: n => `Build a ×${n} ring chain`,     have: () => G.secChain },
};
/** How much stiffer each objective gets per extra time round the tour. */
const OBJ_STEP = { rings: 4, under: 1, gold: 1, low: 10, chain: 1 };
const OBJ_CAP = { chain: 8 };

/** Hazards, by the name world.js spawns them under, with their base weights. */
export const HAZARDS = { lines: 0.30, masts: 0.22, turbines: 0.20, balloons: 0.16, flocks: 0.12 };
const HAZARD_NAMES = { lines: "power lines", masts: "radio masts", turbines: "wind turbines",
                       balloons: "hot-air balloons", flocks: "bird flocks" };

/**
 * The five sectors. `land` names a terrain theme (terrain.js), `tod` a time of
 * day (sky.js), `weather` a weather (weather.js), `dest` an airfield layout
 * (airfields.js). `density` is how thickly hazards are strung along the
 * course, 0 to 1.
 */
export const TOUR = [
  { key: "meadows", name: "Home Meadows", land: "MEADOWS", tod: "MORNING", weather: "CLEAR",
    length: 5200, hazards: [], density: 0, goldRate: 0.22, dest: "gliding",
    objective: { kind: "rings", n: 10 },
    brief: "A gentle first leg over the home farms: hedges, oaks and no hazards at all. Find your line through the gates, then land at the gliding club on the edge of the downs." },
  { key: "downs", name: "The Chalk Downs", land: "DOWNLAND", tod: "MIDDAY", weather: "THERMALS",
    length: 5800, hazards: ["lines", "masts"], density: 0.50, goldRate: 0.24, dest: "wartime",
    objective: { kind: "under", n: 2 },
    brief: "Big open fields and bare chalk ridges under a hot midday sun, thermals bubbling off the slopes and pylons striding across it all. Your field is an old wartime aerodrome: long concrete, arched hangars." },
  { key: "lakes", name: "Lake Country", land: "LAKELAND", tod: "AFTERNOON", weather: "SHOWERS",
    length: 6200, hazards: ["lines", "balloons", "flocks"], density: 0.62, goldRate: 0.30, dest: "lakeside",
    objective: { kind: "gold", n: 3 },
    brief: "Water in every valley, stone walls and dark woods, and showers sweeping through. Balloonists and birds share the air. Down at the lakeside flying club." },
  { key: "glens", name: "Highland Glens", land: "HIGHLANDS", tod: "GOLDEN", weather: "BREEZY",
    length: 6600, hazards: ["turbines", "masts", "flocks"], density: 0.72, goldRate: 0.26, dest: "highland",
    objective: { kind: "low", n: 20 },
    brief: "Heather, pine and snow on the tops in the low evening light, a crosswind gusting down the glens and turbines on every ridge. The strip at the end is short, narrow gravel: come in slow and on the numbers." },
  { key: "vale", name: "The Evening Vale", land: "VALE", tod: "DUSK", weather: "CLEAR",
    length: 7000, hazards: ["lines", "masts", "turbines", "balloons", "flocks"], density: 0.85, goldRate: 0.30,
    dest: "regional",
    objective: { kind: "chain", n: 6 },
    brief: "Orchards and golden stubble under a setting sun, and everything that bites all at once. The regional airport's runway lights will be on by the time you get there." },
];

/** Where the very first sector starts. */
const HOME_FIELD = "farm";

/**
 * One sector as flown: the tour's entry resolved against how many times round
 * the tour this is. `n` is the sector number of the run (G.lvl).
 */
function resolve(n){
  const i = (n - 1) % TOUR.length, lap = Math.floor((n - 1) / TOUR.length);
  const def = TOUR[i];
  const o = def.objective;
  const need = Math.min(OBJ_CAP[o.kind] || Infinity, o.n + OBJ_STEP[o.kind] * lap);
  return {
    n, def, lap, index: i,
    key: def.key,
    name: def.name + (lap ? " " + ["", "II", "III", "IV", "V"][Math.min(lap, 4)] : ""),
    // every hazard is in play once you have been round once
    hazards: lap ? Object.keys(HAZARDS) : def.hazards,
    density: Math.min(1.3, def.density + lap * 0.25),
    goldRate: Math.min(0.40, def.goldRate + lap * 0.04),
    length: def.length + lap * 600,
    fuelBurn: 1 + lap * 0.10,
    // each sector is worth a quarter more than the last
    mult: 1 + (n - 1) * 0.25,
    objective: { kind: o.kind, need, text: OBJ[o.kind].text(need) },
    depart: n === 1 ? HOME_FIELD : TOUR[(n - 2) % TOUR.length].dest,
    dest: def.dest,
  };
}

/** What changes from the previous sector, for the briefing: the new hazards. */
function newHazards(n){
  const now = resolve(n).hazards;
  const before = n > 1 ? resolve(n - 1).hazards : [];
  return now.filter(h => !before.includes(h)).map(h => HAZARD_NAMES[h]);
}

export const Tour = {
  /** The sector being flown. */
  cur: resolve(1),
  /** Look a sector up without making it current (the briefing for the next one). */
  peek(n){ return resolve(n); },
  newHazards,
  /** Make sector n current and clear its tallies. */
  begin(n){
    this.cur = resolve(n);
    G.under = 0; G.lowT = 0; G.objDone = false; G.landGrade = 0; G.secChain = 0;
    base.rings = G.rings; base.hit = G.ringsHit; base.gold = G.goldHit;
    return this.cur;
  },
  /** This sector's gates: { seen, hit }. */
  rings(){ return { seen: G.rings - base.rings, hit: sectorRings() }; },

  // ---------- the objective ----------
  /** { text, have, need, done } for the HUD and the cards. */
  progress(){
    const o = this.cur.objective;
    const have = Math.min(o.need, OBJ[o.kind].have());
    return { text: o.text, have, need: o.need, done: G.objDone };
  },
  /** Called every flying frame: pays the objective bonus the moment it is met. */
  tick(){
    if (G.objDone) return;
    const o = this.cur.objective;
    if (OBJ[o.kind].have() >= o.need) {
      G.objDone = true;
      const v = award(2000);
      popup("OBJECTIVE COMPLETE +" + v.toLocaleString());
      chime(990); setTimeout(() => chime(1320), 110); setTimeout(() => chime(1760), 220);
    }
  },
  /**
   * The sector's stars, out of three: the objective, most of the rings, and a
   * proper landing at the far end.
   */
  stars(){
    const r = this.rings();
    const ringsOk = r.seen > 0 && r.hit / r.seen >= 0.7;
    return (G.objDone ? 1 : 0) + (ringsOk ? 1 : 0) + (G.landGrade >= 2 ? 1 : 0);
  },
  /** How far through the sector the aircraft is, 0 to 1. */
  progressFrac(){
    return Math.max(0, Math.min(1, 1 - (G.levelEnd - P.dist) / G.levelLen));
  },
};
