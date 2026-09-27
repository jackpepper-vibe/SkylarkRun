// Skylark Run — the hangar: every aeroplane a pilot can choose.
//
// An aircraft is data: how it flies, how tough it is, how far a tank takes it,
// what its engine sounds like, and which cockpit the pilot sits in. The flight
// model, the damage rules, the audio and the cockpit manager all read the
// selected entry through Aircraft.spec, so adding a type is adding a row here
// and a cockpit module, nothing else.
//
// Handling numbers are in the same units as config.js (metres, seconds):
//   speed0 / speedMax / ramp  cruise at the start of a sector, top speed, and
//                             how fast she winds up between the two
//   maxVx / maxVy             lateral and vertical authority
//   bank                      how far she rolls for full stick
//   vr / approach             rotation speed and approach speed
//   fuelBurn                  tank fraction burned per second, relative
//   lives                     how many strikes the airframe takes
//   scoreMul                  the harder the aeroplane, the more a run pays
//   open                      whether the slipstream reaches the pilot

/** The fleet, in the order the hangar shows it. */
export const AIRCRAFT = [
  {
    id: "skylark", name: "Skylark Mk II", kind: "Vintage parasol",
    blurb: "The one the race is named for: a doped-linen parasol monoplane with a walnut panel, brass dials and a leather coaming. Forgiving, honest, and slower than she looks.",
    cockpit: "vintage", open: true,
    speed0: 55, speedMax: 118, ramp: 0.45, maxVx: 84, maxVy: 50, bank: 0.40,
    vr: 44, approach: 48, fuelBurn: 0.90, lives: 3, scoreMul: 1.1,
    engine: { base: 52, perSpeed: 0.56, fire: 18, firePer: 0.20, lowpass: 820, gain: 0.11, wind: 1.0 },
    stats: { speed: 3, agility: 3, toughness: 3, range: 3 },
  },
  {
    id: "linnet", name: "Linnet", kind: "Open-cockpit biplane",
    blurb: "A tandem two-seat trainer flown from the back seat. Two wings, a forest of struts and wires, and the tightest turn in the hangar. Slow, so she scores a little less.",
    cockpit: "biplane", open: true,
    speed0: 48, speedMax: 104, ramp: 0.40, maxVx: 88, maxVy: 54, bank: 0.46,
    vr: 38, approach: 42, fuelBurn: 0.82, lives: 3, scoreMul: 1.0,
    engine: { base: 46, perSpeed: 0.58, fire: 16, firePer: 0.22, lowpass: 760, gain: 0.12, wind: 1.1 },
    stats: { speed: 2, agility: 5, toughness: 3, range: 3 },
  },
  {
    id: "wayfarer", name: "Wayfarer", kind: "Enclosed cabin monoplane",
    blurb: "A high-wing four-seater with a heater, a radio stack and a yoke. Out of the wind and built like a shed: she takes a fourth hit and goes furthest on a tank, but she turns like one too.",
    cockpit: "cabin", open: false,
    speed0: 56, speedMax: 120, ramp: 0.45, maxVx: 70, maxVy: 42, bank: 0.30,
    vr: 44, approach: 50, fuelBurn: 0.72, lives: 4, scoreMul: 0.9,
    engine: { base: 60, perSpeed: 0.50, fire: 24, firePer: 0.22, lowpass: 560, gain: 0.09, wind: 0.35 },
    stats: { speed: 3, agility: 2, toughness: 5, range: 5 },
  },
  {
    id: "dragonfly", name: "Dragonfly", kind: "Flex-wing microlight",
    blurb: "A trike: a pod, a seat, a pusher engine behind you and a sail overhead you steer by the bar. Barely faster than the traffic on the lanes, sips fuel, and folds up if you look at it wrongly.",
    cockpit: "trike", open: true,
    speed0: 38, speedMax: 82, ramp: 0.35, maxVx: 64, maxVy: 44, bank: 0.36,
    vr: 28, approach: 34, fuelBurn: 0.55, lives: 2, scoreMul: 0.8,
    engine: { base: 118, perSpeed: 1.10, fire: 58, firePer: 0.60, lowpass: 1500, gain: 0.08, wind: 1.25 },
    stats: { speed: 1, agility: 4, toughness: 1, range: 5 },
  },
  {
    id: "sunburst", name: "Sunburst 330", kind: "Modern aerobatic",
    blurb: "A carbon-fibre unlimited aerobatic single-seater with a glass panel and a red sunburst nose. The fastest thing in the hangar and the least patient: she pays best, if you can keep up.",
    cockpit: "modern", open: true,
    speed0: 62, speedMax: 136, ramp: 0.50, maxVx: 96, maxVy: 58, bank: 0.42,
    vr: 50, approach: 54, fuelBurn: 1.00, lives: 3, scoreMul: 1.3,
    engine: { base: 72, perSpeed: 0.62, fire: 26, firePer: 0.26, lowpass: 900, gain: 0.10, wind: 1.0 },
    stats: { speed: 5, agility: 5, toughness: 2, range: 2 },
  },
];

const KEY = "skylark-aircraft";
const byId = id => AIRCRAFT.find(a => a.id === id);

function stored(){
  try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
}

/**
 * The selected aircraft. Everything that depends on the type subscribes with
 * onChange rather than polling, so a choice in the hangar reaches the flight
 * model, the cockpit and the engine note in the same frame.
 */
export const Aircraft = {
  list: AIRCRAFT,
  spec: byId(stored()) || byId("sunburst"),
  listeners: [],
  get id(){ return this.spec.id; },
  /** Select a type by id; unknown ids are ignored. Persists the choice. */
  select(id){
    const a = byId(id);
    if (!a || a === this.spec) return this.spec;
    this.spec = a;
    try { window.localStorage.setItem(KEY, a.id); } catch (e) {}
    for (const f of this.listeners) f(a);
    return a;
  },
  /** Call f now and on every later change. */
  onChange(f){ this.listeners.push(f); f(this.spec); },
  /** Step through the fleet, wrapping at the ends. */
  cycle(step){
    const i = AIRCRAFT.indexOf(this.spec);
    return this.select(AIRCRAFT[(i + step + AIRCRAFT.length) % AIRCRAFT.length].id);
  },
};
