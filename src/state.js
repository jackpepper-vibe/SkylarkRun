// Skylark Run — shared runtime state.
//
// ES modules hand out live *read-only* bindings: a module cannot assign to a
// `let` that another module declared. Anything reassigned from more than one
// place therefore lives as a field on `Game` rather than as a bare binding, so
// `Game.state = S.PLAY` works from wherever the flight is being driven.
//
// Objects that are only ever mutated in place — the aircraft, the scoreboard —
// need no such wrapper and are exported directly.

import { SPEED0 } from './plane/config.js';

// af.phase: 0 idle · 1 approach · 2 rollout · 3 approach over · 4 take-off roll · 5 climb-out
export const S = { MENU:0, PLAY:1, PAUSE:2, OVER:3, CLEAR:4, DYING:5, ROLLOUT:6, TAKEOFF:7 };

/** Everything that is reassigned rather than mutated. */
export const Game = {
  state: S.MENU,
  shake: 0,
  flash: 0,
  whiteout: 0,
  tPrev: 0,
  readyT: 0,              // 3-2-1 hold before the controls go live
  scarfPhase: 0,
  warnObst: false,
  lastBeep: 0,
  lastFuelBeep: 0,
  dying: { t:0, roll:0, title:"", sub:"" },
  curTod: 0,              // time of day, cycled per sector
  curTheme: 0,
  postOn: true,           // bloom and god rays, toggleable from the HUD
  attractOn: false,       // the countryside flying itself behind the menu
  simHold: false,         // test hook: keep rendering, stop the clock
  looping: true,          // cleared on exit so the aircraft stops burning battery
  // Weather sits here rather than in weather.js so the cloud field can read it
  // without the two modules importing each other.
  weather: 0, wind: 0, windTarget: 0, gustEnd: 0, nextGust: 0, thermal: 0,
  orientPaused: false,
  prePauseState: S.PLAY
};

/** Take-off: rotation speed, then the rotation itself. */
export const TO = { vr:50, vrT:0, rotT:0, lifted:false };

/** The aircraft. */
export const P = { x:0, y:120, z:0, pz:0, vx:0, vy:0, speed:SPEED0,
                   lives:3, invuln:0, dist:0, roll:0 };

/** The run: score, fuel, sector and the gate tally. */
export const G = { score:0, combo:0, bestCombo:0, fuel:100, lvl:1, levelEnd:5400,
                   rings:0, ringsHit:0, gold:0, goldHit:0, landLabel:"" };

export const dents = [];    // cowling damage accumulated over the run
export const popups = [];

export function popup(txt){
  popups.push({ txt, t0: performance.now() });
  if(popups.length > 5) popups.shift();
}
